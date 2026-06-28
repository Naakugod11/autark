/**
 * deploy-your-agent.ts — Deploy an Autark agent in one command.
 *
 * Usage:
 *   npx tsx deploy-your-agent.ts [--name "my-agent"] [--selftest] [--verbose]
 *
 * --selftest   Fund a throwaway consumer from your wallet, propose a job,
 *              let the agent work it autonomously, then assert scoreCompleted 0→1.
 * --name       Display name embedded in endpointUrl (e.g. "my-agent").
 * --verbose    Print all logs including RPC noise and AutarkAgent internals.
 *
 * Keypair is persisted at .agent/agent-keypair.json (gitignored, stable identity).
 * RPC from SOLANA_RPC_URL env — Helius devnet recommended for reliability.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
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
  getAssociatedTokenAddressSync,
  transfer as splTransfer,
} from "@solana/spl-token";
import { EventParser } from "@anchor-lang/core";
import {
  AutarkAgent,
  AutarkClient,
  fetchAgent,
  agentPda,
  jobOfferPda,
} from "./sdk/src";
import type { JobOfferData } from "./sdk/src";

// ── Config ─────────────────────────────────────────────────────────────────────

const CONFIG_PATH  = path.join(__dirname, "devnet.config.json");
const KEYPAIR_PATH = path.join(__dirname, ".agent", "agent-keypair.json");
const RPC_URL      = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID   = new PublicKey("FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy");

const MIN_SOL  = 0.05;
const MIN_USDC = 20;

// ── Args ───────────────────────────────────────────────────────────────────────

const _args    = process.argv.slice(2);
const SELFTEST = _args.includes("--selftest");
const VERBOSE  = _args.includes("--verbose");
const _ni      = _args.indexOf("--name");
const AGENT_NAME = _ni >= 0 && _args[_ni + 1] ? _args[_ni + 1] : "autark-agent";

// ── Noise suppression ─────────────────────────────────────────────────────────

const _log   = console.log.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);

const _isNoise = (m: string) =>
  m.startsWith("[AutarkAgent]") ||
  m.includes("429") ||
  m.includes("Too Many Requests") ||
  m.includes("Retrying after") ||
  m.startsWith("ws error:") ||
  m.startsWith("Server responded with");

console.log   = (...a) => { if (!VERBOSE && _isNoise(String(a[0] ?? ""))) return; _log(...a); };
console.warn  = (...a) => { if (!VERBOSE && _isNoise(String(a[0] ?? ""))) return; _warn(...a); };
console.error = (...a) => { if (!VERBOSE && _isNoise(String(a[0] ?? ""))) return; _error(...a); };

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
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
        msg.includes("timeout") || msg.includes("429") || msg.includes("503");
      if (!transient) throw e;
      await sleep(2_000 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

function loadOrCreateKeypair(filepath: string): Keypair {
  if (fs.existsSync(filepath)) {
    return Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync(filepath, "utf-8")))
    );
  }
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(Array.from(kp.secretKey)));
  _log(`New keypair generated and saved to ${filepath}`);
  return kp;
}

async function getUsdcBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<number> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner, false);
    const bal = await conn.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

// ── Template onJob ─────────────────────────────────────────────────────────────
// Works with NO API key — canned deterministic analysis.
//
// To use Claude instead:
//   1. npm install @anthropic-ai/sdk
//   2. Set ANTHROPIC_API_KEY in .env
//   3. Uncomment the Claude block below.

async function onJob(
  job: JobOfferData
): Promise<{ deliver: true; result: string } | { decline: true }> {
  const amountUsdc = (job.amount / 1_000_000).toFixed(2);

  // ── Optional Claude block ─────────────────────────────────────────────────
  // import Anthropic from "@anthropic-ai/sdk";
  // if (process.env.ANTHROPIC_API_KEY) {
  //   const ai = new Anthropic();
  //   const msg = await ai.messages.create({
  //     model: "claude-sonnet-4-6",
  //     max_tokens: 200,
  //     messages: [{
  //       role: "user",
  //       content: `Token-research job: ${amountUsdc} USDC, consumer ${job.consumer.toBase58().slice(0,8)}. Give a 2-sentence analysis.`,
  //     }],
  //   });
  //   return { deliver: true, result: (msg.content[0] as any).text };
  // }
  // ─────────────────────────────────────────────────────────────────────────

  const result = [
    `[${AGENT_NAME}] Token-research analysis for consumer ${job.consumer.toBase58().slice(0, 8)}…`,
    `Job value: ${amountUsdc} USDC | Delivered autonomously via Autark protocol on Solana devnet.`,
    `Assessment: Market conditions nominal. No anomalies detected. Recommendation: proceed.`,
  ].join(" ");

  return { deliver: true, result };
}

// ── Simple event poller (selftest only) ────────────────────────────────────────

async function waitForEvent(
  conn: Connection,
  parser: EventParser,
  eventName: string,
  filterFn: (data: any) => boolean,
  seen: Set<string>,
  timeoutMs: number
): Promise<{ data: any; signature: string; slot: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let sigs: Awaited<ReturnType<typeof conn.getSignaturesForAddress>>;
    try {
      sigs = await conn.getSignaturesForAddress(PROGRAM_ID, { limit: 30 });
    } catch { await sleep(2_000); continue; }

    for (const sigInfo of [...sigs].reverse()) {
      if (sigInfo.err || seen.has(sigInfo.signature)) continue;
      seen.add(sigInfo.signature);
      let tx: any = null;
      try {
        tx = await conn.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
      } catch { continue; }
      if (!tx?.meta?.logMessages) continue;
      try {
        for (const ev of parser.parseLogs(tx.meta.logMessages, false)) {
          if (ev.name === eventName && filterFn(ev.data)) {
            return { data: ev.data, signature: sigInfo.signature, slot: tx.slot };
          }
        }
      } catch { /* malformed logs */ }
    }
    await sleep(2_000);
  }
  throw new Error(`Timeout (${timeoutMs / 1000}s) waiting for ${eventName}`);
}

// ── Selftest ───────────────────────────────────────────────────────────────────

async function runSelftest(
  agentKp: Keypair,
  agentClient: AutarkClient,
  testMint: PublicKey
): Promise<void> {
  const conn   = agentClient.connection;
  const meStr  = agentKp.publicKey.toBase58();

  _log("\n════════════════════════════════════════════════════");
  _log(" SELF-TEST: autonomous hire → deliver → pay loop");
  _log("════════════════════════════════════════════════════\n");

  // Wait two poll cycles so the agent can settle any stale SettlementPending
  // jobs left over from previous runs before we snapshot scoreBefore.
  _log("Waiting for agent warm-up (2 poll cycles)…");
  await sleep(12_000);

  // Read scoreCompleted before — now clean of any prior-run leftovers
  const agentAddr  = agentPda(agentKp.publicKey);
  const before     = await fetchAgent(agentClient.program, agentAddr);
  const scoreBefore = before.scoreCompleted;
  _log(`Agent scoreCompleted before: ${scoreBefore}`);

  // 1. Warm up seen set (captures current chain state)
  const seen = new Set<string>();
  const preSigs = await conn.getSignaturesForAddress(PROGRAM_ID, { limit: 50 });
  for (const s of preSigs) seen.add(s.signature);
  _log(`Event seen-set warmed: ${seen.size} signatures\n`);

  // 2. Create throwaway consumer
  const consumerKp = Keypair.generate();
  _log(`Consumer (throwaway): ${consumerKp.publicKey.toBase58()}`);

  // 3. Fund consumer: 0.05 SOL for fees
  _log("Sending 0.05 SOL to consumer…");
  {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: agentKp.publicKey,
        toPubkey:   consumerKp.publicKey,
        lamports:   Math.floor(0.05 * LAMPORTS_PER_SOL),
      })
    );
    const sig = await withRetry("sol-to-consumer", () =>
      conn.sendTransaction(tx, [agentKp])
    );
    await conn.confirmTransaction(sig, "confirmed");
    _log(`  ✓ SOL funded (${sig.slice(0, 20)}…)`);
  }

  // 4. Fund consumer: 10 USDC (from agent ATA)
  _log("Sending 10 USDC to consumer…");
  {
    const consumerAta = await withRetry("consumer-ata", () =>
      getOrCreateAssociatedTokenAccount(conn, agentKp, testMint, consumerKp.publicKey)
    );
    const agentAta = getAssociatedTokenAddressSync(testMint, agentKp.publicKey, false);
    const sig = await withRetry("usdc-to-consumer", () =>
      splTransfer(conn, agentKp, agentAta, consumerAta.address, agentKp, 10_000_000)
    );
    _log(`  ✓ USDC funded (${sig.slice(0, 20)}…)`);
  }

  // 5. Consumer proposes 5 USDC job (5s challenge + defense window for fast selftest)
  _log("\nProposing 5 USDC job to agent…");
  const jobId   = Array.from(crypto.randomBytes(32));
  const consumerClient = AutarkClient.fromKeypair(consumerKp, RPC_URL);
  const now = Math.floor(Date.now() / 1000);
  const jobSig = await withRetry("proposeJob", () =>
    consumerClient.ix.proposeJob({
      jobId:                 Uint8Array.from(jobId),
      provider:              agentKp.publicKey,
      amount:                5,
      acceptanceDeadline:    now + 120,
      deliveryDeadline:      now + 600,
      challengeWindowSeconds: 8,
      defenseWindowSeconds:   8,
      mint:                  testMint,
    }).rpc()
  );
  _log(`  ✓ Job proposed (${jobSig.slice(0, 20)}…)`);
  _log("\nWaiting for autonomous agent execution…\n");

  // Compute the job PDA for precise event filtering
  const jobPda    = jobOfferPda(consumerKp.publicKey, Uint8Array.from(jobId));
  const jobPdaStr = jobPda.toBase58();

  // Build parser for event watching
  const parser = new EventParser(PROGRAM_ID, agentClient.program.coder);
  const byProvider = (d: any) => d.provider?.toBase58() === meStr;
  const byJob      = (d: any) => d.job?.toBase58() === jobPdaStr;

  // 6. Watch events in sequence
  _log("  → jobAccepted …");
  const acc = await waitForEvent(conn, parser, "jobAccepted", byProvider, seen, 90_000);
  _log(`  ✓ jobAccepted       slot=${acc.slot}  tx=${acc.signature.slice(0, 20)}…`);

  _log("  → settlementPendingEvent …");
  const pend = await waitForEvent(conn, parser, "settlementPendingEvent", byProvider, seen, 60_000);
  _log(`  ✓ settlementPending slot=${pend.slot}  tx=${pend.signature.slice(0, 20)}…`);

  _log("  → jobSettled (waiting up to 90s for challenge window + crank) …");
  // Filter by THIS job's PDA so concurrent settlements from prior runs don't confuse the assertion.
  const settled = await waitForEvent(conn, parser, "jobSettled", byJob, seen, 90_000);
  _log(`  ✓ jobSettled        slot=${settled.slot}  tx=${settled.signature.slice(0, 20)}…`);

  // 7. Verify scoreCompleted 0→N+1 via on-chain read
  const after      = await fetchAgent(agentClient.program, agentAddr);
  const scoreAfter = after.scoreCompleted;

  _log(`\nAgent scoreCompleted: ${scoreBefore} → ${scoreAfter}`);
  if (scoreAfter <= scoreBefore) {
    throw new Error(
      `Assertion FAIL: scoreCompleted did not increase (${scoreBefore} → ${scoreAfter})`
    );
  }

  const agentUsdc = await getUsdcBalance(conn, agentKp.publicKey, testMint);
  _log(`Agent USDC balance:   ${agentUsdc.toFixed(2)}`);
  _log(`\n✓ ASSERTION PASS — scoreCompleted incremented (${scoreBefore} → ${scoreAfter})\n`);
  _log("════════════════════════════════════════════════════");
  _log(" Self-test COMPLETE. Agent is hired, paid, and live.");
  _log("════════════════════════════════════════════════════\n");
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const config   = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const testMint = new PublicKey(config.testMint);
  const agentKp  = loadOrCreateKeypair(KEYPAIR_PATH);
  const conn     = new Connection(RPC_URL, "confirmed");

  _log("\n╔══════════════════════════════════════════╗");
  _log("║        Autark Agent Deployer             ║");
  _log("╚══════════════════════════════════════════╝");
  _log(`  Wallet : ${agentKp.publicKey.toBase58()}`);
  _log(`  RPC    : ${RPC_URL}`);
  _log(`  Mint   : ${testMint.toBase58()}\n`);

  // Best-effort devnet SOL airdrop
  const solBefore = (await conn.getBalance(agentKp.publicKey)) / LAMPORTS_PER_SOL;
  if (solBefore < MIN_SOL) {
    _log("Attempting devnet SOL airdrop (best-effort)…");
    try {
      const sig = await conn.requestAirdrop(agentKp.publicKey, LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
      _log("  ✓ Airdrop OK.\n");
    } catch {
      _log("  Airdrop failed (normal on public devnet).\n");
    }
  }

  // Funding check
  const sol  = (await conn.getBalance(agentKp.publicKey)) / LAMPORTS_PER_SOL;
  const usdc = await getUsdcBalance(conn, agentKp.publicKey, testMint);

  if (sol < MIN_SOL || usdc < MIN_USDC) {
    _log(`⚠  Not funded yet.`);
    _log(`   Address : ${agentKp.publicKey.toBase58()}`);
    _log(`   Balance : ${sol.toFixed(4)} SOL  /  ${usdc} USDC`);
    _log(`   Need    : ≥${MIN_SOL} SOL + ≥${MIN_USDC} USDC (test tokens, no real money)`);
    _log(`\n   → DM @naaku_builds on X with your address to get funded.`);
    _log(`   Keypair saved at .agent/agent-keypair.json — run again after funding.\n`);
    process.exit(0);
  }

  _log(`Balances OK  —  SOL: ${sol.toFixed(4)}  USDC: ${usdc}`);

  // Build client (for selftest; AutarkAgent builds its own internally)
  const agentClient = AutarkClient.fromKeypair(agentKp, RPC_URL);

  // Start agent
  const agent = new AutarkAgent({
    keypair:       agentKp,
    capabilities:  ["token-research"],
    endpointUrl:   `autark:${AGENT_NAME}`,
    mint:          testMint,
    minStake:      MIN_USDC,
    pollIntervalMs: SELFTEST ? 5_000 : 10_000,
    onJob,
  });

  await agent.start();

  _log(`\n✓ Agent LIVE and listening`);
  _log(`  Name   : ${AGENT_NAME}`);
  _log(`  Pubkey : ${agentKp.publicKey.toBase58()}\n`);

  if (!SELFTEST) {
    _log("Press Ctrl+C to stop.\n");
    return; // keep process alive — setInterval inside AutarkAgent holds the event loop
  }

  // --selftest mode
  try {
    await sleep(2_000); // let agent poll loop initialize
    await runSelftest(agentKp, agentClient, testMint);
  } catch (e: any) {
    _error("✗ Self-test failed:", e?.message ?? e);
    agent.stop();
    process.exit(1);
  }

  agent.stop();
  process.exit(0);
}

main().catch((e: any) => {
  _error("✗ Fatal:", e?.message ?? e);
  process.exit(1);
});
