/**
 * scripts/faucet.ts — Naaku's testnet funding faucet.
 *
 * Drips devnet SOL + test USDC to a stranger's agent address.
 * Only the deployer keypair (mint authority) can mint test USDC.
 *
 * Usage:
 *   npx tsx scripts/faucet.ts <ADDRESS> [--sol 0.5] [--usdc 100]
 *
 * Defaults: 0.5 SOL, 100 USDC — enough to stake + run a selftest.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

// ── Config ─────────────────────────────────────────────────────────────────────

const CONFIG_PATH   = path.join(__dirname, "../devnet.config.json");
const DEPLOYER_PATH =
  process.env.WALLET_KEYPAIR_PATH ??
  path.join(process.env.HOME ?? "~", ".config/solana/id.json");
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e: any) {
      if (i === tries - 1) throw e;
      const msg = String(e?.message ?? e);
      const transient =
        msg.includes("Blockhash not found") ||
        msg.includes("block height exceeded") ||
        msg.includes("timeout") ||
        msg.includes("429") ||
        msg.includes("503");
      if (!transient) throw e;
      console.log(`  [retry] ${label} attempt ${i + 2}/${tries}…`);
      await sleep(2_000 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

function parseArg(args: string[], flag: string, def: number): number {
  const i = args.indexOf(flag);
  if (i < 0 || !args[i + 1]) return def;
  const v = parseFloat(args[i + 1]);
  if (isNaN(v)) throw new Error(`Invalid value for ${flag}: ${args[i + 1]}`);
  return v;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const recipientStr = args.find((a) => !a.startsWith("--") && args.indexOf(a) === args.findIndex(x => !x.startsWith("--")));
  if (!recipientStr) {
    console.error("Usage: npx tsx scripts/faucet.ts <ADDRESS> [--sol 0.5] [--usdc 100]");
    process.exit(1);
  }

  let recipient: PublicKey;
  try {
    recipient = new PublicKey(recipientStr);
  } catch {
    console.error(`Invalid address: ${recipientStr}`);
    process.exit(1);
  }

  const solAmount  = parseArg(args, "--sol",  0.5);
  const usdcAmount = parseArg(args, "--usdc", 100);

  const config   = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const testMint = new PublicKey(config.testMint);
  const deployer = loadKeypair(DEPLOYER_PATH);
  const conn     = new Connection(RPC_URL, "confirmed");

  console.log(`\nAutark Faucet`);
  console.log(`  RPC      : ${RPC_URL}`);
  console.log(`  Deployer : ${deployer.publicKey.toBase58()}`);
  console.log(`  Mint     : ${testMint.toBase58()}`);
  console.log(`  Target   : ${recipient.toBase58()}`);
  console.log(`  Amount   : ${solAmount} SOL  +  ${usdcAmount} USDC\n`);

  // Check deployer balance
  const deployerSol = await conn.getBalance(deployer.publicKey);
  if (deployerSol < (solAmount + 0.01) * LAMPORTS_PER_SOL) {
    console.error(`Deployer has only ${(deployerSol / LAMPORTS_PER_SOL).toFixed(4)} SOL — need ${solAmount + 0.01}`);
    process.exit(1);
  }

  // SOL transfer
  console.log(`Sending ${solAmount} SOL…`);
  {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey:   recipient,
        lamports:   Math.floor(solAmount * LAMPORTS_PER_SOL),
      })
    );
    const sig = await withRetry("sol-transfer", () => conn.sendTransaction(tx, [deployer]));
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  ✓ SOL sent: ${sig.slice(0, 20)}…`);
  }

  // USDC: create ATA if needed, then mintTo
  console.log(`Minting ${usdcAmount} USDC…`);
  {
    const ata = await withRetry("create-ata", () =>
      getOrCreateAssociatedTokenAccount(conn, deployer, testMint, recipient)
    );
    const sig = await withRetry("mint-usdc", () =>
      mintTo(conn, deployer, testMint, ata.address, deployer, Math.round(usdcAmount * 1_000_000))
    );
    console.log(`  ✓ USDC minted: ${sig.slice(0, 20)}…`);
  }

  // Verify final balances
  const finalSol  = await conn.getBalance(recipient);
  const finalUsdc = await conn.getTokenAccountBalance(
    (await import("@solana/spl-token")).getAssociatedTokenAddressSync(testMint, recipient, false)
  );
  console.log(`\n✓ Funded ${recipient.toBase58()}:`);
  console.log(`  SOL  : ${(finalSol / LAMPORTS_PER_SOL).toFixed(4)}`);
  console.log(`  USDC : ${finalUsdc.value.uiAmount}\n`);
}

main().catch((e: any) => {
  console.error("\n✗ Faucet failed:", e?.message ?? e);
  process.exit(1);
});
