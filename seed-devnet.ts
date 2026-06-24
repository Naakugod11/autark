/**
 * seed-devnet.ts — idempotent devnet bootstrap for Autark.
 *
 * Run:  npx tsx seed-devnet.ts
 * Re-run is safe — all singleton inits are skipped when already present.
 *
 * Writes devnet.config.json at repo root on success.
 * Persists test-mint keypair in .devnet/mint-keypair.json (gitignored).
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { AutarkClient, accs } from "./sdk/src/client";
import {
  mintWhitelistPda,
  slashingPoolPda,
  poolVault,
  PROGRAM_ID,
} from "./sdk/src/pdas";

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH =
  process.env.WALLET_KEYPAIR_PATH ??
  path.join(process.env.HOME ?? "~", ".config/solana/id.json");
const DEVNET_DIR = path.join(__dirname, ".devnet");
const MINT_KEYPAIR_PATH = path.join(DEVNET_DIR, "mint-keypair.json");
const AGENT_WALLET_1_PATH = path.join(DEVNET_DIR, "agent-wallet-1.json");
const AGENT_WALLET_2_PATH = path.join(DEVNET_DIR, "agent-wallet-2.json");
const CONFIG_OUT = path.join(__dirname, "devnet.config.json");

const PRIORITY_MICROLAMPORTS = 50_000;
const TEST_MINT_DECIMALS = 6;
const MINT_AMOUNT = 10_000 * 10 ** TEST_MINT_DECIMALS; // 10,000 test tokens

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Buffer.from(raw));
}

function loadOrCreate(filePath: string): Keypair {
  if (fs.existsSync(filePath)) {
    return loadKeypair(filePath);
  }
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)), "utf-8");
  console.log(`  Generated new keypair → ${filePath}`);
  return kp;
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = 5
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i === retries - 1) throw e;
      const msg = String(e?.message ?? e);
      const transient =
        msg.includes("Blockhash not found") ||
        msg.includes("block height exceeded") ||
        msg.includes("timeout") ||
        msg.includes("429");
      if (!transient) throw e;
      console.log(`  [${label}] transient error, retry ${i + 1}/${retries}…`);
      await new Promise((r) => setTimeout(r, 2_500 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

function priorityFeeIx() {
  return ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: PRIORITY_MICROLAMPORTS,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Autark devnet seed ===");
  console.log(`RPC: ${RPC_URL}`);

  // Load deployer wallet
  const deployer = loadKeypair(WALLET_PATH);
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);

  const client = AutarkClient.fromKeypair(deployer, RPC_URL);
  const conn = client.connection;

  // Check deployer balance
  const balance = await conn.getBalance(deployer.publicKey);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    throw new Error("Deployer balance too low — top up devnet wallet first");
  }

  fs.mkdirSync(DEVNET_DIR, { recursive: true });

  // ── 1. initMintWhitelist ──────────────────────────────────────────────────
  const wlPda = mintWhitelistPda();
  console.log(`\nMintWhitelist PDA: ${wlPda.toBase58()}`);

  const wlExisting = await conn.getAccountInfo(wlPda);
  if (!wlExisting) {
    console.log("  Initialising MintWhitelist…");
    const sig = await withRetry("initMintWhitelist", () =>
      client.program.methods
        .initMintWhitelist()
        .accounts(
          accs({
            mintWhitelist: wlPda,
            authority: deployer.publicKey,
            systemProgram: SystemProgram.programId,
          })
        )
        .preInstructions([priorityFeeIx()])
        .rpc()
    );
    console.log(`  ✓ ${sig}`);
  } else {
    console.log("  Already initialised, skipping.");
  }

  // ── 2. Create / load persistent test mint ────────────────────────────────
  const mintKp = loadOrCreate(MINT_KEYPAIR_PATH);
  const testMint = mintKp.publicKey;
  console.log(`\nTest mint: ${testMint.toBase58()}`);

  const mintAcct = await conn.getAccountInfo(testMint);
  if (!mintAcct) {
    console.log("  Creating test mint…");
    await withRetry("createMint", () =>
      createMint(
        conn,
        deployer,
        deployer.publicKey, // mintAuthority = deployer
        null,
        TEST_MINT_DECIMALS,
        mintKp
      )
    );
    console.log("  ✓ Mint created");
  } else {
    console.log("  Mint already exists on chain.");
  }

  // ── 3. addWhitelistedMint ────────────────────────────────────────────────
  console.log("\nWhitelisting test mint…");
  const wlData: any = await client.program.account.mintWhitelist.fetch(wlPda);
  const alreadyListed = (wlData.mints as PublicKey[]).some((m) =>
    m.equals(testMint)
  );
  if (!alreadyListed) {
    const sig = await withRetry("addWhitelistedMint", () =>
      client.program.methods
        .addWhitelistedMint(testMint)
        .accounts(
          accs({
            mintWhitelist: wlPda,
            authority: deployer.publicKey,
          })
        )
        .preInstructions([priorityFeeIx()])
        .rpc()
    );
    console.log(`  ✓ ${sig}`);
  } else {
    console.log("  Already whitelisted, skipping.");
  }

  // ── 4. initSlashingPool ──────────────────────────────────────────────────
  const poolPda = slashingPoolPda();
  const vaultAddr = poolVault(poolPda, testMint);
  console.log(`\nSlashingPool PDA: ${poolPda.toBase58()}`);
  console.log(`SlashingPool vault: ${vaultAddr.toBase58()}`);

  const poolExisting = await conn.getAccountInfo(poolPda);
  if (!poolExisting) {
    console.log("  Initialising SlashingPool…");
    const sig = await withRetry("initSlashingPool", () =>
      client.program.methods
        .initSlashingPool()
        .accounts(
          accs({
            mintWhitelist: wlPda,
            slashingPool: poolPda,
            mint: testMint,
            vault: vaultAddr,
            authority: deployer.publicKey,
            tokenProgram: new PublicKey(
              "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            ),
            associatedTokenProgram: new PublicKey(
              "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
            ),
            systemProgram: SystemProgram.programId,
          })
        )
        .preInstructions([priorityFeeIx()])
        .rpc()
    );
    console.log(`  ✓ ${sig}`);
  } else {
    console.log("  Already initialised, skipping.");
  }

  // ── 5. Mint test tokens to wallets ───────────────────────────────────────
  const agentWallet1 = loadOrCreate(AGENT_WALLET_1_PATH);
  const agentWallet2 = loadOrCreate(AGENT_WALLET_2_PATH);
  const recipients = [
    { label: "deployer", owner: deployer.publicKey },
    { label: "agent-wallet-1", owner: agentWallet1.publicKey },
    { label: "agent-wallet-2", owner: agentWallet2.publicKey },
  ];

  console.log("\nMinting test tokens…");
  for (const { label, owner } of recipients) {
    console.log(`  → ${label} (${owner.toBase58().slice(0, 8)}…)`);
    const ata = await withRetry(`getOrCreateATA-${label}`, () =>
      getOrCreateAssociatedTokenAccount(conn, deployer, testMint, owner)
    );
    await withRetry(`mintTo-${label}`, () =>
      mintTo(conn, deployer, testMint, ata.address, deployer, MINT_AMOUNT)
    );
    console.log(
      `    ✓ minted ${MINT_AMOUNT / 10 ** TEST_MINT_DECIMALS} tokens → ${ata.address.toBase58()}`
    );
  }

  // ── 6. Write devnet.config.json ──────────────────────────────────────────
  const config = {
    programId: PROGRAM_ID.toBase58(),
    cluster: "devnet",
    testMint: testMint.toBase58(),
    mintWhitelistPda: wlPda.toBase58(),
    slashingPoolPda: poolPda.toBase58(),
    slashingPoolVault: vaultAddr.toBase58(),
  };
  fs.writeFileSync(CONFIG_OUT, JSON.stringify(config, null, 2), "utf-8");
  console.log("\n=== devnet.config.json ===");
  console.log(JSON.stringify(config, null, 2));
  console.log("\n✓ Seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
