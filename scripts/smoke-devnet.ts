/**
 * smoke-devnet.ts — full happy-path + dispute-path smoke test on live devnet.
 *
 * Run:  npx tsx scripts/smoke-devnet.ts
 *
 * Requires:
 *   - devnet.config.json at repo root (written by seed-devnet.ts)
 *   - .devnet/agent-wallet-1.json
 *   - Deployer keypair at WALLET_KEYPAIR_PATH or ~/.config/solana/id.json
 *   - All wallets funded with SOL and test tokens (run seed-devnet.ts first)
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { AutarkClient } from "../sdk/src/client";
import { agentPda } from "../sdk/src/pdas";
import { fetchAgent } from "../sdk/src/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, "..");
const WALLET_PATH =
  process.env.WALLET_KEYPAIR_PATH ??
  path.join(process.env.HOME ?? "~", ".config/solana/id.json");
const AGENT_WALLET_1_PATH = path.join(REPO_ROOT, ".devnet/agent-wallet-1.json");
const CONFIG_PATH = path.join(REPO_ROOT, "devnet.config.json");

// challenge_window_seconds = 1s so we only need a brief sleep before
// claimSettlement / resolveChallenge. We sleep 3s to give devnet clock slack.
const WINDOW_SECONDS = 1;
const WINDOW_SLEEP_MS = 3_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Buffer.from(raw));
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
      console.log(`  [${label}] transient, retry ${i + 1}/${retries}…`);
      await sleep(2_500 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function newJobId(): Uint8Array {
  return crypto.randomBytes(32);
}

function step(n: number, label: string) {
  console.log(`\n── Step ${n}: ${label}`);
}

function ok(sig: string) {
  console.log(`   ✓ ${sig}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Autark smoke test (devnet) ===");

  // ── Load config ─────────────────────────────────────────────────────────────
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error("devnet.config.json not found — run seed-devnet.ts first");
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const testMint = new PublicKey(config.testMint);
  console.log(`Program:   ${config.programId}`);
  console.log(`Test mint: ${testMint.toBase58()}`);

  // ── Load keypairs ───────────────────────────────────────────────────────────
  const deployer = loadKeypair(WALLET_PATH);
  const agentWallet1 = loadKeypair(AGENT_WALLET_1_PATH);
  console.log(`Deployer:  ${deployer.publicKey.toBase58()}`);
  console.log(`Provider:  ${agentWallet1.publicKey.toBase58()}`);

  const deployerClient = AutarkClient.fromKeypair(deployer);
  const agentClient = AutarkClient.fromKeypair(agentWallet1);
  const conn = deployerClient.connection;

  // ── Ensure agent-wallet-1 has SOL ───────────────────────────────────────────
  step(0, "Fund agent-wallet-1 with SOL if needed");
  const agentBal = await conn.getBalance(agentWallet1.publicKey);
  console.log(`   Balance: ${(agentBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (agentBal < 0.05 * LAMPORTS_PER_SOL) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: agentWallet1.publicKey,
        lamports: Math.floor(0.1 * LAMPORTS_PER_SOL),
      })
    );
    const sig = await withRetry("fundAgent", () =>
      conn.sendTransaction(tx, [deployer])
    );
    await conn.confirmTransaction(sig, "confirmed");
    ok(sig);
    console.log(`   Funded 0.1 SOL → agent-wallet-1`);
  } else {
    console.log(`   Sufficient, skipping.`);
  }

  // ── Ensure agent-wallet-1 has test USDC ─────────────────────────────────────
  // Mint authority = deployer (set in seed-devnet.ts via createMint(..., deployer.publicKey, ...)).
  // There is no separate test-mint-authority.json; deployer IS the authority.
  step(1, "Ensure agent-wallet-1 has test USDC (mint if needed)");
  const agentAta = await withRetry("getOrCreateATA-agent1", () =>
    getOrCreateAssociatedTokenAccount(conn, deployer, testMint, agentWallet1.publicKey)
  );
  const usdcBalance = Number(agentAta.amount);
  console.log(`   USDC balance: ${usdcBalance / 1_000_000} USDC`);
  if (usdcBalance < 100_000_000) {
    // Mint 100 USDC so the agent can stake and the script is self-sufficient.
    await withRetry("mintToAgent1", () =>
      mintTo(conn, deployer, testMint, agentAta.address, deployer, 100_000_000)
    );
    console.log(`   Minted 100 USDC → ${agentAta.address.toBase58().slice(0, 8)}…`);
  } else {
    console.log(`   Sufficient, skipping.`);
  }

  // ── Register agent (idempotent) ──────────────────────────────────────────────
  // MIN_STAKE_AMOUNT = 10_000_000 micro-USDC (10 USDC).
  // Builder toUSDC() takes whole USDC floats (× 1e6), so 20.0 → 20_000_000.
  step(2, "Register agent-wallet-1 (idempotent)");
  const agentAddr = agentPda(agentWallet1.publicKey);
  const agentAcct = await conn.getAccountInfo(agentAddr);
  if (!agentAcct) {
    const sig = await withRetry("registerAgent", () =>
      agentClient.ix
        .registerAgent({
          capabilities: ["code-gen", "data-analysis"],
          endpointUrl: "https://agent1.smoke.test",
          initialStake: 20.0, // 20 USDC = 20_000_000 micro-USDC; MIN is 10 USDC
          mint: testMint,
        })
        .rpc()
    );
    ok(sig);
  } else {
    console.log(`   Already registered, skipping.`);
  }

  const agentBefore = await fetchAgent(deployerClient.program, agentAddr);
  console.log(
    `   score_completed=${agentBefore.scoreCompleted}  score_failed=${agentBefore.scoreFailed}`
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // HAPPY PATH
  // ══════════════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════╗");
  console.log("║  HAPPY PATH                  ║");
  console.log("╚══════════════════════════════╝");

  const happyJobId = newJobId();
  const now = Math.floor(Date.now() / 1000);

  step(3, "proposeJob (deployer → agent-wallet-1)");
  {
    const sig = await withRetry("proposeJob", () =>
      deployerClient.ix
        .proposeJob({
          jobId: happyJobId,
          provider: agentWallet1.publicKey,
          amount: 1.0, // 1 USDC
          acceptanceDeadline: now + 3600,
          deliveryDeadline: now + 7200,
          challengeWindowSeconds: WINDOW_SECONDS,
          defenseWindowSeconds: WINDOW_SECONDS,
          mint: testMint,
        })
        .rpc()
    );
    ok(sig);
  }

  step(4, "acceptJob (agent-wallet-1)");
  {
    const sig = await withRetry("acceptJob", () =>
      agentClient.ix
        .acceptJob({
          consumer: deployer.publicKey,
          jobId: happyJobId,
        })
        .rpc()
    );
    ok(sig);
  }

  step(5, "releaseEscrow (agent-wallet-1 marks delivery done)");
  {
    const sig = await withRetry("releaseEscrow", () =>
      agentClient.ix
        .releaseEscrow({
          consumer: deployer.publicKey,
          jobId: happyJobId,
        })
        .rpc()
    );
    ok(sig);
  }

  step(6, `Wait ${WINDOW_SLEEP_MS / 1000}s for challenge window to expire`);
  await sleep(WINDOW_SLEEP_MS);
  console.log(`   Done waiting.`);

  step(7, "claimSettlement (deployer as cranker)");
  {
    const sig = await withRetry("claimSettlement", () =>
      deployerClient.ix
        .claimSettlement({
          consumer: deployer.publicKey,
          jobId: happyJobId,
          providerWallet: agentWallet1.publicKey,
          mint: testMint,
        })
        .rpc()
    );
    ok(sig);
  }

  const agentAfterHappy = await fetchAgent(deployerClient.program, agentAddr);
  console.log(
    `\n   score_completed=${agentAfterHappy.scoreCompleted}  score_failed=${agentAfterHappy.scoreFailed}`
  );
  if (agentAfterHappy.scoreCompleted <= agentBefore.scoreCompleted) {
    throw new Error(
      `FAIL: score_completed did not increase (${agentBefore.scoreCompleted} → ${agentAfterHappy.scoreCompleted})`
    );
  }
  console.log(
    `   ✓ score_completed incremented: ${agentBefore.scoreCompleted} → ${agentAfterHappy.scoreCompleted}`
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // DISPUTE PATH (undefended challenge → provider slashed)
  // ══════════════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════╗");
  console.log("║  DISPUTE PATH                ║");
  console.log("╚══════════════════════════════╝");

  const disputeJobId = newJobId();
  const now2 = Math.floor(Date.now() / 1000);

  step(8, "proposeJob #2 (deployer → agent-wallet-1)");
  {
    const sig = await withRetry("proposeJob2", () =>
      deployerClient.ix
        .proposeJob({
          jobId: disputeJobId,
          provider: agentWallet1.publicKey,
          amount: 1.0,
          acceptanceDeadline: now2 + 3600,
          deliveryDeadline: now2 + 7200,
          challengeWindowSeconds: WINDOW_SECONDS,
          defenseWindowSeconds: WINDOW_SECONDS,
          mint: testMint,
        })
        .rpc()
    );
    ok(sig);
  }

  step(9, "acceptJob #2");
  {
    const sig = await withRetry("acceptJob2", () =>
      agentClient.ix
        .acceptJob({
          consumer: deployer.publicKey,
          jobId: disputeJobId,
        })
        .rpc()
    );
    ok(sig);
  }

  step(10, "releaseEscrow #2");
  {
    const sig = await withRetry("releaseEscrow2", () =>
      agentClient.ix
        .releaseEscrow({
          consumer: deployer.publicKey,
          jobId: disputeJobId,
        })
        .rpc()
    );
    ok(sig);
  }

  step(11, "challengeSettlement (deployer opens dispute)");
  {
    const sig = await withRetry("challengeSettlement", () =>
      deployerClient.ix
        .challengeSettlement({
          jobId: disputeJobId,
          mint: testMint,
        })
        .rpc()
    );
    ok(sig);
  }

  step(12, `Wait ${WINDOW_SLEEP_MS / 1000}s for defense window to expire (provider does NOT defend)`);
  await sleep(WINDOW_SLEEP_MS);
  console.log(`   Done waiting.`);

  const agentBeforeResolve = await fetchAgent(
    deployerClient.program,
    agentAddr
  );
  console.log(
    `   score_failed before resolve: ${agentBeforeResolve.scoreFailed}`
  );

  step(13, "resolveChallenge (deployer as cranker, undefended → provider slashed)");
  {
    const sig = await withRetry("resolveChallenge", () =>
      deployerClient.ix
        .resolveChallenge({
          consumer: deployer.publicKey,
          jobId: disputeJobId,
          provider: agentWallet1.publicKey,
          challenger: deployer.publicKey,
          mint: testMint,
          consumerAgent: null, // deployer is not a registered agent
        })
        .rpc()
    );
    ok(sig);
  }

  const agentAfterDispute = await fetchAgent(deployerClient.program, agentAddr);
  console.log(
    `\n   score_completed=${agentAfterDispute.scoreCompleted}  score_failed=${agentAfterDispute.scoreFailed}  slash_events=${agentAfterDispute.slashEvents}`
  );
  if (agentAfterDispute.scoreFailed <= agentBeforeResolve.scoreFailed) {
    throw new Error(
      `FAIL: score_failed did not increase (${agentBeforeResolve.scoreFailed} → ${agentAfterDispute.scoreFailed})`
    );
  }
  console.log(
    `   ✓ score_failed incremented: ${agentBeforeResolve.scoreFailed} → ${agentAfterDispute.scoreFailed}`
  );

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  ALL SMOKE TESTS PASSED                      ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\nFinal agent-wallet-1 state:`);
  console.log(`  score_completed : ${agentAfterDispute.scoreCompleted}`);
  console.log(`  score_failed    : ${agentAfterDispute.scoreFailed}`);
  console.log(`  slash_events    : ${agentAfterDispute.slashEvents}`);
}

main().catch((e) => {
  console.error("\n✗ SMOKE TEST FAILED:", e?.message ?? e);
  if (e?.logs) {
    console.error("Program logs:");
    e.logs.forEach((l: string) => console.error("  ", l));
  }
  process.exit(1);
});
