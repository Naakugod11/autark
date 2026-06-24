/**
 * scripts/runtime-smoke.ts — end-to-end runtime validation on live devnet.
 *
 * Proves:
 *   1. research-agent starts, registers if needed.
 *   2. Consumer proposes a targeted-hire job; runtime auto-accepts, calls onJob
 *      (Claude), releaseEscrow's; consumer's challenge window expires; agent
 *      self-claims → job Settled, score_completed incremented.
 *   3. Consumer proposes a second job; agent accepts + releases; consumer
 *      challengeSettlement's → agent detects challenge, onChallenged fires,
 *      defendChallenge lands → challenge.state == "defended".
 *   4. Loop-resilience: one deliberately-bad poll iteration is injected and
 *      confirmed to not kill the loop.
 *
 * Run:  npx tsx scripts/runtime-smoke.ts
 */

import "dotenv/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { AutarkClient } from "../sdk/src/client";
import { agentPda, challengePda, jobOfferPda } from "../sdk/src/pdas";
import {
  fetchAgent,
  fetchJobOffer,
  fetchChallenge,
  JobOfferData,
  ChallengeData,
} from "../sdk/src/types";
import { researchAgent } from "../agents/research-agent";

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, "..");
const DEPLOYER_PATH =
  process.env.WALLET_KEYPAIR_PATH ??
  path.join(process.env.HOME ?? "~", ".config/solana/id.json");
const CONSUMER_PATH = path.join(REPO_ROOT, ".devnet/agent-wallet-2.json");
const CONFIG_PATH = path.join(REPO_ROOT, "devnet.config.json");

const WINDOW_SECONDS = 3; // short but with slack vs devnet clock drift
const POLL_TIMEOUT_MS = 40_000; // max wait for runtime to react (5s poll + tx latency)

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(p, "utf-8")))
  );
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

function step(label: string) {
  console.log(`\n── ${label}`);
}

function ok(label: string, sig: string) {
  console.log(`   ✓ ${label}: ${sig.slice(0, 60)}…`);
}

async function waitForJobStatus(
  client: AutarkClient,
  pubkey: PublicKey,
  expected: string,
  label: string,
  timeoutMs = POLL_TIMEOUT_MS
): Promise<JobOfferData> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await fetchJobOffer(client.program, pubkey);
    if (job.status === expected) return job;
    process.stdout.write(`   … waiting for ${expected} (current: ${job.status})\r`);
    await sleep(3_000);
  }
  const job = await fetchJobOffer(client.program, pubkey);
  throw new Error(
    `[${label}] Timeout: job ${pubkey.toBase58().slice(0, 8)}… status=${job.status}, expected=${expected}`
  );
}

async function waitForChallengeState(
  client: AutarkClient,
  pubkey: PublicKey,
  expected: string,
  label: string,
  timeoutMs = POLL_TIMEOUT_MS
): Promise<ChallengeData> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ch = await fetchChallenge(client.program, pubkey);
    if (ch.state === expected) return ch;
    process.stdout.write(`   … waiting for challenge=${expected} (current: ${ch.state})\r`);
    await sleep(3_000);
  }
  const ch = await fetchChallenge(client.program, pubkey);
  throw new Error(
    `[${label}] Timeout: challenge state=${ch.state}, expected=${expected}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Autark runtime smoke test (devnet) ===");

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const testMint = new PublicKey(config.testMint);
  console.log(`Program:  ${config.programId}`);
  console.log(`Mint:     ${testMint.toBase58()}`);

  const deployer = loadKeypair(DEPLOYER_PATH);
  const consumer = loadKeypair(CONSUMER_PATH); // agent-wallet-2 acts as consumer
  const consumerClient = AutarkClient.fromKeypair(consumer);
  const conn = consumerClient.connection;

  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);
  console.log(`Consumer: ${consumer.publicKey.toBase58()}`);
  console.log(`Agent:    ${researchAgent.me.toBase58()}`);

  // ── Fund consumer with SOL + USDC ─────────────────────────────────────────
  step("Fund consumer (SOL + USDC)");
  const consumerSol = await conn.getBalance(consumer.publicKey);
  if (consumerSol < 0.05 * LAMPORTS_PER_SOL) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: consumer.publicKey,
        lamports: Math.floor(0.1 * LAMPORTS_PER_SOL),
      })
    );
    const sig = await withRetry("fundSOL", () =>
      conn.sendTransaction(tx, [deployer])
    );
    await conn.confirmTransaction(sig, "confirmed");
    ok("SOL funded", sig);
  } else {
    console.log(`   SOL OK (${(consumerSol / LAMPORTS_PER_SOL).toFixed(4)})`);
  }

  const deployerKp = loadKeypair(DEPLOYER_PATH);
  const consumerAta = await withRetry("getOrCreateATA", () =>
    getOrCreateAssociatedTokenAccount(conn, deployerKp, testMint, consumer.publicKey)
  );
  const usdcBal = Number(consumerAta.amount);
  if (usdcBal < 100_000_000) {
    await withRetry("mintUSDC", () =>
      mintTo(conn, deployerKp, testMint, consumerAta.address, deployerKp, 100_000_000)
    );
    console.log("   Minted 100 USDC → consumer ATA");
  } else {
    console.log(`   USDC OK (${usdcBal / 1_000_000} USDC)`);
  }

  // ── Start research agent runtime ──────────────────────────────────────────
  step("Start research-agent runtime");
  await researchAgent.start();
  console.log("   Runtime started. Status:", researchAgent.status());

  // Brief pause so any leftover stale poll cycle clears
  await sleep(500);

  // ════════════════════════════════════════════════════════════════════════════
  // HAPPY PATH — auto-accept → work → release → self-claim
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n╔════════════════════════════════╗");
  console.log("║  HAPPY PATH                    ║");
  console.log("╚════════════════════════════════╝");

  const happyJobId = crypto.randomBytes(32);
  const happyJobPda = jobOfferPda(consumer.publicKey, happyJobId);
  const now = Math.floor(Date.now() / 1000);

  // Deliver jobId hint to runtime BEFORE proposing so it's ready on first poll.
  researchAgent.notifyJob(happyJobId, consumer.publicKey);

  step("proposeJob → consumer");
  {
    const sig = await withRetry("proposeJob", () =>
      consumerClient.ix
        .proposeJob({
          jobId: happyJobId,
          provider: researchAgent.me,
          amount: 1.0,
          acceptanceDeadline: now + 3600,
          deliveryDeadline: now + 7200,
          challengeWindowSeconds: WINDOW_SECONDS,
          defenseWindowSeconds: WINDOW_SECONDS,
          mint: testMint,
        })
        .rpc()
    );
    ok("proposeJob", sig);
    console.log(`   JobPDA: ${happyJobPda.toBase58()}`);
  }

  step("Wait for runtime to accept + releaseEscrow");
  await waitForJobStatus(
    consumerClient,
    happyJobPda,
    "settlementPending",
    "happy:release",
    POLL_TIMEOUT_MS
  );
  console.log(`\n   ✓ Job reached settlementPending — runtime accepted and released`);

  const resultKey = happyJobPda.toBase58();
  const storedResult = researchAgent.jobResults.get(resultKey);
  if (!storedResult) throw new Error("FAIL: jobResults map has no entry for happy job");
  console.log(`   ✓ Result stored (${storedResult.length} chars)`);

  // Snapshot score BEFORE claim fires — must be taken while job is still in
  // settlementPending (claimSettlement hasn't run yet).
  const agentAddrHappy = agentPda(researchAgent.me);
  const agentBeforeClaim = await fetchAgent(consumerClient.program, agentAddrHappy);
  console.log(`   score_completed (before claim): ${agentBeforeClaim.scoreCompleted}`);

  // Sleep until challenge window is definitely elapsed + one poll cycle buffer.
  // WINDOW_SECONDS + 2 ensures the on-chain clock is past the deadline when the
  // runtime fires its next claimSettlement attempt, preventing ChallengeWindowNotElapsed.
  const claimSleepMs = (WINDOW_SECONDS + 2) * 1000;
  step(`Wait ${claimSleepMs / 1000}s for challenge window to clear`);
  await sleep(claimSleepMs);
  console.log("   Done waiting.");

  step("Wait for runtime to claimSettlement → job Settled");
  await waitForJobStatus(
    consumerClient,
    happyJobPda,
    "settled",
    "happy:claim",
    POLL_TIMEOUT_MS
  );
  console.log("\n   ✓ Job status = settled");

  const agentAfterClaim = await fetchAgent(consumerClient.program, agentAddrHappy);
  if (agentAfterClaim.scoreCompleted <= agentBeforeClaim.scoreCompleted) {
    throw new Error(
      `FAIL: score_completed did not increment (${agentBeforeClaim.scoreCompleted} → ${agentAfterClaim.scoreCompleted})`
    );
  }
  console.log(
    `   ✓ score_completed: ${agentBeforeClaim.scoreCompleted} → ${agentAfterClaim.scoreCompleted}`
  );

  // ════════════════════════════════════════════════════════════════════════════
  // DEFEND PATH — accept → release → consumer challenges → agent defends
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n╔════════════════════════════════╗");
  console.log("║  DEFEND PATH                   ║");
  console.log("╚════════════════════════════════╝");

  const disputeJobId = crypto.randomBytes(32);
  const disputeJobPda = jobOfferPda(consumer.publicKey, disputeJobId);
  const now2 = Math.floor(Date.now() / 1000);

  researchAgent.notifyJob(disputeJobId, consumer.publicKey);

  step("proposeJob #2 → consumer");
  {
    const sig = await withRetry("proposeJob2", () =>
      consumerClient.ix
        .proposeJob({
          jobId: disputeJobId,
          provider: researchAgent.me,
          amount: 1.0,
          acceptanceDeadline: now2 + 3600,
          deliveryDeadline: now2 + 7200,
          challengeWindowSeconds: WINDOW_SECONDS,
          defenseWindowSeconds: WINDOW_SECONDS,
          mint: testMint,
        })
        .rpc()
    );
    ok("proposeJob2", sig);
  }

  step("Wait for runtime to accept + release #2");
  await waitForJobStatus(
    consumerClient,
    disputeJobPda,
    "settlementPending",
    "dispute:release",
    POLL_TIMEOUT_MS
  );
  console.log("\n   ✓ Job #2 settlementPending — runtime released");

  step("Consumer opens challengeSettlement");
  {
    const sig = await withRetry("challengeSettlement", () =>
      consumerClient.ix
        .challengeSettlement({
          jobId: disputeJobId,
          mint: testMint,
        })
        .rpc()
    );
    ok("challengeSettlement", sig);
  }

  // Verify the job moved to Challenged status
  await waitForJobStatus(
    consumerClient,
    disputeJobPda,
    "challenged",
    "dispute:challenged",
    10_000
  );
  console.log("\n   ✓ Job status = challenged");

  const challengeAddr = challengePda(disputeJobPda);
  console.log(`   ChallengePDA: ${challengeAddr.toBase58()}`);

  step("Wait for runtime to detect challenge and defendChallenge");
  const ch = await waitForChallengeState(
    consumerClient,
    challengeAddr,
    "defended",
    "dispute:defend",
    POLL_TIMEOUT_MS
  );
  console.log(
    `\n   ✓ Challenge state = defended` +
      ` | defenseStake=${ch.defenseStake / 1_000_000} USDC`
  );

  // ════════════════════════════════════════════════════════════════════════════
  // LOOP-RESILIENCE CHECK
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n╔════════════════════════════════╗");
  console.log("║  LOOP RESILIENCE               ║");
  console.log("╚════════════════════════════════╝");
  step("Inject a bad poll iteration via internal throw");
  {
    // Patch _pollOnce temporarily to throw once; confirm loop continues.
    const agent = researchAgent as any;
    const real = agent._pollOnce.bind(agent);
    let threw = false;
    agent._pollOnce = async () => {
      if (!threw) {
        threw = true;
        agent._pollOnce = real; // restore
        throw new Error("SYNTHETIC_POLL_ERROR (intentional resilience test)");
      }
      return real();
    };
    // Wait 2 poll cycles
    await sleep(agent.cfg.pollIntervalMs * 2 + 500);
    const s = researchAgent.status();
    if (!s.running) throw new Error("FAIL: runtime is no longer running after bad iteration");
    console.log(`   ✓ Runtime still running after synthetic error | status: ${JSON.stringify(s)}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  researchAgent.stop();

  const agentFinal = await fetchAgent(consumerClient.program, agentAddrHappy);
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  ALL RUNTIME SMOKE TESTS PASSED                  ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("\nFinal agent state:");
  console.log(`  score_completed : ${agentFinal.scoreCompleted}`);
  console.log(`  score_failed    : ${agentFinal.scoreFailed}`);
  console.log(`  slash_events    : ${agentFinal.slashEvents}`);
  console.log(`  open_jobs       : ${agentFinal.openJobs}`);
}

main().catch((e: any) => {
  researchAgent.stop();
  console.error("\n✗ RUNTIME SMOKE FAILED:", e?.message ?? e);
  if (e?.logs) {
    console.error("Program logs:");
    e.logs.forEach((l: string) => console.error("  ", l));
  }
  process.exit(1);
});
