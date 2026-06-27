/**
 * scripts/events-smoke.ts — Layer 4 event stream validation on live devnet.
 *
 * Proves:
 *  1. events.stream() starts, runs backfill from a recent slot, then switches
 *     to the live feed with no duplicate delivery across the handoff boundary.
 *  2. A real propose→accept→releaseEscrow→claimSettlement sequence is driven
 *     on devnet; the stream delivers at minimum:
 *       JobProposed, JobAccepted, SettlementPendingEvent, JobSettled
 *     each with correct slot, signature, and decoded fields.
 *  3. De-dup key `${sig}:${idx}` prevents double-counting at the overlap.
 *
 * Run: npx tsx scripts/events-smoke.ts
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
import { BN } from "@anchor-lang/core";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { AutarkClient } from "../sdk/src/client";
import { agentPda, jobOfferPda, mintWhitelistPda } from "../sdk/src/pdas";
import { fetchAgent, fetchJobOffer } from "../sdk/src/types";
import {
  AutarkEvent,
  AutarkEventHandlers,
  stream,
  backfill,
} from "../sdk/src/events";

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, "..");
const DEPLOYER_PATH =
  process.env.WALLET_KEYPAIR_PATH ??
  path.join(process.env.HOME ?? "~", ".config/solana/id.json");
const CONSUMER_PATH = path.join(REPO_ROOT, ".devnet/agent-wallet-2.json");
const CONFIG_PATH = path.join(REPO_ROOT, "devnet.config.json");

const CHALLENGE_WINDOW = 5;  // seconds — short for testing (no challenge opened)
const JOB_AMOUNT_SOL = 0.5;  // USDC

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
      console.log(`  [${label}] transient error, retry ${i + 1}/${retries}…`);
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

function ok(label: string, value?: string) {
  const suffix = value ? `: ${value.slice(0, 60)}…` : "";
  console.log(`   ✓ ${label}${suffix}`);
}

function formatEvent(ev: AutarkEvent, idx: number): string {
  const key = `${ev.signature.slice(0, 8)}:${idx}`;
  const slot = ev.slot;
  const bt = ev.blockTime ? new Date(ev.blockTime * 1000).toISOString() : "?";
  let detail = "";
  switch (ev.name) {
    case "jobProposed":
      detail = `job=${ev.data.job.toBase58().slice(0, 8)} amount=${ev.data.amount.toNumber() / 1e6} USDC`;
      break;
    case "jobAccepted":
      detail = `job=${ev.data.job.toBase58().slice(0, 8)} stakeLocked=${ev.data.stakeLocked.toNumber() / 1e6}`;
      break;
    case "settlementPendingEvent":
      detail = `job=${ev.data.job.toBase58().slice(0, 8)} eligibleAt=${ev.data.settleEligibleAt.toNumber()}`;
      break;
    case "jobSettled":
      detail = `job=${ev.data.job.toBase58().slice(0, 8)} amount=${ev.data.amount.toNumber() / 1e6} scoreCompleted=${ev.data.scoreCompleted.toNumber()}`;
      break;
    default:
      detail = JSON.stringify(
        Object.entries(ev.data as Record<string, any>)
          .slice(0, 2)
          .reduce((o, [k, v]) => ({ ...o, [k]: v?.toBase58?.() ?? v?.toString?.() ?? v }), {})
      );
  }
  return `  [${key}] slot=${slot} t=${bt} ${ev.name}: ${detail}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Autark event stream smoke test (devnet) ===");

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const testMint = new PublicKey(config.testMint);
  console.log(`Program:  ${config.programId}`);
  console.log(`Mint:     ${testMint.toBase58()}`);

  const deployer = loadKeypair(DEPLOYER_PATH);
  const consumer = loadKeypair(CONSUMER_PATH);
  const consumerClient = AutarkClient.fromKeypair(consumer);
  const conn = consumerClient.connection;
  const program = consumerClient.program;

  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);
  console.log(`Consumer: ${consumer.publicKey.toBase58()}`);

  // ── Fund consumer ─────────────────────────────────────────────────────────
  step("Fund consumer if needed");
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
  if (Number(consumerAta.amount) < 10_000_000) {
    await withRetry("mintUSDC", () =>
      mintTo(conn, deployerKp, testMint, consumerAta.address, deployerKp, 100_000_000)
    );
    console.log("   Minted 100 USDC → consumer");
  } else {
    console.log(`   USDC OK (${Number(consumerAta.amount) / 1e6} USDC)`);
  }

  // ── Capture current slot (backfill anchor point) ──────────────────────────
  step("Capture current slot for backfill anchor");
  const startSlot = await conn.getSlot("confirmed");
  // Back off a few slots so the from-slot window includes our tx when fired
  const fromSlot = startSlot - 5;
  console.log(`   fromSlot: ${fromSlot} (current: ${startSlot})`);

  // ── Start the unified stream BEFORE driving the job ───────────────────────
  step("Start events.stream()");

  const captured: AutarkEvent[] = [];
  const seenKeys = new Set<string>();
  let dupCount = 0;

  // Track per-signature event indices for our own dedup assertion
  const perSigIdx = new Map<string, number>();

  const handlers: AutarkEventHandlers = {
    jobProposed: (ev) => {
      const sig = ev.signature;
      const idx = perSigIdx.get(sig) ?? 0;
      perSigIdx.set(sig, idx + 1);
      const key = `${sig}:${idx}`;
      if (seenKeys.has(key)) { dupCount++; return; }
      seenKeys.add(key);
      captured.push(ev);
      console.log(formatEvent(ev, captured.length - 1));
    },
    jobAccepted: (ev) => {
      const sig = ev.signature;
      const idx = perSigIdx.get(sig) ?? 0;
      perSigIdx.set(sig, idx + 1);
      const key = `${sig}:${idx}`;
      if (seenKeys.has(key)) { dupCount++; return; }
      seenKeys.add(key);
      captured.push(ev);
      console.log(formatEvent(ev, captured.length - 1));
    },
    settlementPendingEvent: (ev) => {
      const sig = ev.signature;
      const idx = perSigIdx.get(sig) ?? 0;
      perSigIdx.set(sig, idx + 1);
      const key = `${sig}:${idx}`;
      if (seenKeys.has(key)) { dupCount++; return; }
      seenKeys.add(key);
      captured.push(ev);
      console.log(formatEvent(ev, captured.length - 1));
    },
    jobSettled: (ev) => {
      const sig = ev.signature;
      const idx = perSigIdx.get(sig) ?? 0;
      perSigIdx.set(sig, idx + 1);
      const key = `${sig}:${idx}`;
      if (seenKeys.has(key)) { dupCount++; return; }
      seenKeys.add(key);
      captured.push(ev);
      console.log(formatEvent(ev, captured.length - 1));
    },
  };

  const unsub = stream(program, handlers, { fromSlot, commitment: "confirmed" });

  // Wait for backfill to complete before driving the job, so backfill doesn't
  // race with the live events from our own txs.
  step("Waiting for backfill to complete…");
  await unsub.ready;
  console.log("   Backfill done.");

  // ── Drive a real propose→accept→release→claim sequence ───────────────────
  // Use deployer as the provider agent (already registered from prior runs)
  // and consumer as the job poster.

  // Register the deployer as an agent if needed
  const deployerClient = AutarkClient.fromKeypair(deployer);
  const providerAgentKey = agentPda(deployer.publicKey);
  const providerAgentInfo = await conn.getAccountInfo(providerAgentKey);

  if (!providerAgentInfo) {
    step("Register deployer as agent (first run)");
    const stakeVault = getAssociatedTokenAddressSync(testMint, providerAgentKey, true);
    const deployerAta = await withRetry("getDeployerATA", () =>
      getOrCreateAssociatedTokenAccount(conn, deployer, testMint, deployer.publicKey)
    );
    if (Number(deployerAta.amount) < 20_000_000) {
      await withRetry("mintForDeployer", () =>
        mintTo(conn, deployer, testMint, deployerAta.address, deployer, 100_000_000)
      );
    }
    const sig = await withRetry("registerAgent", () =>
      deployerClient.ix
        .registerAgent({
          capabilities: ["wallet-analysis"],
          endpointUrl: "https://provider.example.com",
          initialStake: 20,
          mint: testMint,
        })
        .rpc()
    );
    ok("Agent registered", sig);
  } else {
    console.log("   Deployer agent already registered.");
  }

  // Propose job
  const jobId = crypto.randomBytes(32);
  const jobPda = jobOfferPda(consumer.publicKey, jobId);
  const now = Math.floor(Date.now() / 1000);

  step("proposeJob");
  const proposeSig = await withRetry("proposeJob", () =>
    consumerClient.ix
      .proposeJob({
        jobId,
        provider: deployer.publicKey,
        amount: JOB_AMOUNT_SOL,
        acceptanceDeadline: now + 3600,
        deliveryDeadline: now + 7200,
        challengeWindowSeconds: CHALLENGE_WINDOW,
        defenseWindowSeconds: CHALLENGE_WINDOW,
        mint: testMint,
      })
      .rpc()
  );
  ok("proposeJob", proposeSig);

  // Accept job (deployer = provider)
  step("acceptJob");
  const acceptSig = await withRetry("acceptJob", () =>
    deployerClient.ix
      .acceptJob({
        consumer: consumer.publicKey,
        jobId: Array.from(jobId),
      })
      .rpc()
  );
  ok("acceptJob", acceptSig);

  // Release escrow (provider signals delivery)
  step("releaseEscrow");
  const releaseSig = await withRetry("releaseEscrow", () =>
    deployerClient.ix
      .releaseEscrow({
        consumer: consumer.publicKey,
        jobId: Array.from(jobId),
      })
      .rpc()
  );
  ok("releaseEscrow", releaseSig);

  // Wait for challenge window to expire
  step(`Wait ${CHALLENGE_WINDOW + 2}s for challenge window to clear`);
  await sleep((CHALLENGE_WINDOW + 2) * 1000);
  console.log("   Done.");

  // Claim settlement
  step("claimSettlement");
  const claimSig = await withRetry("claimSettlement", () =>
    deployerClient.ix
      .claimSettlement({
        consumer: consumer.publicKey,
        jobId: Array.from(jobId),
        providerWallet: deployer.publicKey,
        mint: testMint,
      })
      .rpc()
  );
  ok("claimSettlement", claimSig);

  // Give the stream a couple of poll cycles to pick up the events
  step("Waiting for live events to propagate…");
  await sleep(8_000);

  unsub();

  // ── Assertions ────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  EVENT STREAM ASSERTIONS                         ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // 1. Required event names in order
  const ourSigs = new Set([proposeSig, acceptSig, releaseSig, claimSig]);
  const ourEvents = captured.filter(
    (ev) => ourSigs.has(ev.signature)
  );
  console.log(`\n   Total events captured (all sigs): ${captured.length}`);
  console.log(`   Events from our tx sequence:      ${ourEvents.length}`);

  const ourNames = ourEvents.map((e) => e.name);
  const required: AutarkEvent["name"][] = [
    "jobProposed",
    "jobAccepted",
    "settlementPendingEvent",
    "jobSettled",
  ];

  console.log(`\n   Event sequence from our txs: [${ourNames.join(", ")}]`);

  for (const name of required) {
    const ev = ourEvents.find((e) => e.name === name);
    if (!ev) throw new Error(`FAIL: expected event '${name}' not found`);
    ok(`${name} present`, ev.signature);
    if (!ev.slot) throw new Error(`FAIL: ${name} has no slot`);
    if (!ev.signature) throw new Error(`FAIL: ${name} has no signature`);
    console.log(`     slot=${ev.slot}`);
  }

  // 2. Check ordering: proposed < accepted < settlementPending < settled
  const propIdx = ourEvents.findIndex((e) => e.name === "jobProposed");
  const accIdx = ourEvents.findIndex((e) => e.name === "jobAccepted");
  const spIdx = ourEvents.findIndex((e) => e.name === "settlementPendingEvent");
  const settIdx = ourEvents.findIndex((e) => e.name === "jobSettled");

  if (!(propIdx < accIdx && accIdx < spIdx && spIdx < settIdx)) {
    throw new Error(
      `FAIL: events out of order: proposed=${propIdx} accepted=${accIdx} settlementPending=${spIdx} settled=${settIdx}`
    );
  }
  ok("Events in correct order (proposed < accepted < settlementPending < settled)");

  // 3. Field assertions
  const proposedEv = ourEvents.find((e) => e.name === "jobProposed")!;
  if (proposedEv.name === "jobProposed") {
    if (!proposedEv.data.job.equals(jobPda))
      throw new Error(`FAIL: JobProposed.job mismatch: ${proposedEv.data.job.toBase58()} vs ${jobPda.toBase58()}`);
    if (!proposedEv.data.consumer.equals(consumer.publicKey))
      throw new Error("FAIL: JobProposed.consumer mismatch");
    if (!proposedEv.data.provider.equals(deployer.publicKey))
      throw new Error("FAIL: JobProposed.provider mismatch");
    const expectedAmount = Math.round(JOB_AMOUNT_SOL * 1_000_000);
    if (proposedEv.data.amount.toNumber() !== expectedAmount)
      throw new Error(`FAIL: JobProposed.amount=${proposedEv.data.amount} expected=${expectedAmount}`);
    ok(`JobProposed fields correct (job=${proposedEv.data.job.toBase58().slice(0,8)} amount=${proposedEv.data.amount.toNumber()/1e6} USDC)`);
  }

  const settledEv = ourEvents.find((e) => e.name === "jobSettled")!;
  if (settledEv.name === "jobSettled") {
    if (!settledEv.data.job.equals(jobPda))
      throw new Error("FAIL: JobSettled.job mismatch");
    if (settledEv.data.scoreCompleted.toNumber() < 1)
      throw new Error(`FAIL: JobSettled.scoreCompleted=${settledEv.data.scoreCompleted} expected ≥1`);
    ok(`JobSettled fields correct (scoreCompleted=${settledEv.data.scoreCompleted.toNumber()})`);
  }

  // 4. Zero duplicates
  if (dupCount > 0) {
    throw new Error(`FAIL: ${dupCount} duplicate events detected across backfill/live handoff`);
  }
  ok(`Zero duplicates across backfill→live handoff`);

  // 5. All captured events have both slot and signature
  const missingMeta = captured.filter((e) => !e.slot || !e.signature);
  if (missingMeta.length > 0) {
    throw new Error(`FAIL: ${missingMeta.length} events missing slot/signature`);
  }
  ok("All events carry slot + signature metadata");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  ALL EVENT STREAM SMOKE TESTS PASSED             ║");
  console.log("╚══════════════════════════════════════════════════╝");

  console.log("\nCaptured event sequence (our txs):");
  ourEvents.forEach((ev, i) => {
    console.log(formatEvent(ev, i));
  });
}

main().catch((e: any) => {
  console.error("\n✗ EVENT SMOKE FAILED:", e?.message ?? e);
  if (e?.logs) {
    console.error("Program logs:");
    e.logs.forEach((l: string) => console.error("  ", l));
  }
  process.exit(1);
});
