#!/usr/bin/env tsx
/**
 * scripts/demo.ts — Autark live demo choreography.
 *
 * Single command: npx tsx scripts/demo.ts [--slow] [--verbose]
 *
 * Runs two complete arcs on live devnet with fresh keypairs each time:
 *   ACT 1 — honest agent earns reputation
 *   ACT 2 — flaky agent gets slashed
 *
 * All narration is driven by real on-chain events — nothing is faked.
 * Fresh keypairs every run → clean 0→1 reputation on screen.
 *
 * Flags:
 *   --slow     Insert cosmetic pauses between beats (for live audiences)
 *   --verbose  Show internal AutarkAgent poll logs
 *
 * NOTE: For a reliable on-stage run set:
 *   SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<YOUR_KEY>
 * The public devnet endpoint imposes rate limits that can slow this down.
 */

import "dotenv/config";
import * as crypto from "crypto";
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
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import Anthropic from "@anthropic-ai/sdk";
import { EventParser } from "@anchor-lang/core";
import { AutarkClient } from "../sdk/src/client";
import { AutarkAgent } from "../sdk/src/runtime";
import { agentPda, stakeVault, jobOfferPda } from "../sdk/src/pdas";
import { fetchAgent } from "../sdk/src/types";
import { AutarkEvent, AutarkEventName } from "../sdk/src/events";
import type { Autark } from "../target/types/autark";
import type { Program } from "@anchor-lang/core";

// ── CLI flags ──────────────────────────────────────────────────────────────────

const SLOW    = process.argv.includes("--slow");
const VERBOSE = process.argv.includes("--verbose");

// ── Timing ────────────────────────────────────────────────────────────────────

const JOB_AMOUNT_USDC    = 5;
const INITIAL_STAKE_USDC = 20;
const SETUP_MINT_USDC    = 60;

// ACT 1: short windows so self-claim is fast
const ACT1_CHALLENGE_WINDOW = 8;  // seconds
const ACT1_DEFENSE_WINDOW   = 8;

// ACT 2: long challenge window (director reacts on event), short defense
const ACT2_CHALLENGE_WINDOW = 30; // seconds
const ACT2_DEFENSE_WINDOW   = 8;  // seconds — expires quickly so slash fires fast

const ACT_TIMEOUT_MS  = 180_000; // 3 min hard timeout per act
const EVENT_POLL_MS   = 4_000;   // how often to fetch new program signatures

// Agent poll interval — keep relaxed on public devnet (2 getProgramAccounts each)
// On Helius/private RPC you can safely drop to 3_000.
const POLL_INTERVAL_MS = 10_000;

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  white:  "\x1b[97m",
  bgBlue: "\x1b[44m",
};

function box(title: string, color = C.cyan): void {
  const inner = `  ${title}  `;
  const bar   = "═".repeat(inner.length);
  out(`${color}╔${bar}╗${C.reset}`);
  out(`${color}║${C.bold}${inner}${C.reset}${color}║${C.reset}`);
  out(`${color}╚${bar}╝${C.reset}`);
}

function out(msg = ""): void { process.stdout.write(msg + "\n"); }

function beat(label: string, detail = ""): void {
  const d = detail ? `  ${C.dim}${detail}${C.reset}` : "";
  out(`  ${C.cyan}●${C.reset} ${label}${d}`);
}

function eventLine(ev: AutarkEvent, extra = ""): void {
  const sig = ev.signature.slice(0, 8);
  const suf = extra ? `  ${extra}` : "";
  out(
    `    ${C.dim}[event]${C.reset} ${C.yellow}${ev.name}${C.reset}` +
    `  slot=${ev.slot}  sig=${sig}…${suf}`
  );
}

function good(msg: string): void  { out(`  ${C.green}✓${C.reset} ${msg}`); }
function setupLine(msg: string): void { out(`  ${C.dim}▸${C.reset} ${msg}`); }

function pause(): Promise<void> {
  return SLOW ? sleep(1_400) : Promise.resolve();
}

// ── Verbosity filter ──────────────────────────────────────────────────────────

let _arcMode = false;
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

function _isNoise(msg: string): boolean {
  return (
    msg.startsWith("[AutarkAgent]") ||
    msg.startsWith("Server responded with 429") ||
    msg.startsWith("ws error:") ||
    msg.includes("Too Many Requests") ||
    msg.includes("Retrying after")
  );
}

console.log = (...args: any[]) => {
  if (_arcMode && !VERBOSE && _isNoise(String(args[0] ?? ""))) return;
  _origLog(...args);
};
console.warn = (...args: any[]) => {
  if (!VERBOSE && _isNoise(String(args[0] ?? ""))) return;
  _origWarn(...args);
};
console.error = (...args: any[]) => {
  if (_arcMode && !VERBOSE && _isNoise(String(args[0] ?? ""))) return;
  _origError(...args);
};

// ── Polling-based event fetcher ───────────────────────────────────────────────
// Uses HTTP getSignaturesForAddress + getTransaction only — no WebSocket.
// This is immune to WS rate limits on the public devnet endpoint.

const PROGRAM_ID = new PublicKey("FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy");

/**
 * EventBus — background poller that fans events out to registered waiters.
 *
 * Fixes the race where acceptJob + releaseEscrow land in the same poll window:
 * every event from each poll() call is dispatched to ALL waiters, not just the
 * one currently awaiting. A shared `seen` set prevents re-delivery.
 */
class EventBus {
  private readonly seen    = new Set<string>();
  private readonly parser  : EventParser;
  private readonly conn    : Connection;
  private readonly waiters = new Map<string, Array<{ resolve: (ev: AutarkEvent) => void; reject: (e: Error) => void }>>();
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly program: Program<Autark>) {
    this.parser = new EventParser(PROGRAM_ID, program.coder);
    this.conn   = program.provider.connection;
  }

  /** Start the background polling loop. */
  start(intervalMs = EVENT_POLL_MS): void {
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try { await this._fetchAndDispatch(); } catch { /* always continue */ }
      if (this.running) this.timer = setTimeout(tick, intervalMs);
    };
    this.timer = setTimeout(tick, 0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Warm: mark existing sigs as seen so only future events are delivered. */
  async warmUp(limit = 50): Promise<void> {
    try {
      const sigs = await this.conn.getSignaturesForAddress(PROGRAM_ID, { limit });
      sigs.forEach((s) => this.seen.add(s.signature));
    } catch { /* ignore */ }
  }

  /** Register a one-shot waiter for a specific event+job combination. */
  wait<K extends AutarkEventName>(
    name: K,
    jobPda: PublicKey,
    timeoutMs: number,
  ): Promise<Extract<AutarkEvent, { name: K }>> {
    const key = `${name}:${jobPda.toBase58()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const arr = this.waiters.get(key);
        if (arr) { const i = arr.findIndex(w => w.reject === reject); if (i >= 0) arr.splice(i, 1); }
        reject(new Error(
          `Timeout (${timeoutMs / 1000}s) waiting for event '${name}' on job ${jobPda.toBase58().slice(0, 8)}…\n` +
          `  Is the RPC healthy? Did the agent start? Run with --verbose for details.`
        ));
      }, timeoutMs);

      const wrapped = {
        resolve: (ev: AutarkEvent) => { clearTimeout(timer); resolve(ev as any); },
        reject,
      };
      if (!this.waiters.has(key)) this.waiters.set(key, []);
      this.waiters.get(key)!.push(wrapped);
    });
  }

  private async _fetchAndDispatch(): Promise<void> {
    let sigs: Awaited<ReturnType<typeof this.conn.getSignaturesForAddress>>;
    try {
      sigs = await this.conn.getSignaturesForAddress(PROGRAM_ID, { limit: 30 });
    } catch { return; }

    const fresh = sigs.filter((s) => !this.seen.has(s.signature) && !s.err);
    if (!fresh.length) return;

    // Oldest-first → chronological delivery.
    for (const sigInfo of [...fresh].reverse()) {
      this.seen.add(sigInfo.signature);
      let tx: Awaited<ReturnType<typeof this.conn.getTransaction>> = null;
      try {
        tx = await this.conn.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
      } catch { continue; }
      if (!tx?.meta?.logMessages) continue;

      const meta = { slot: tx.slot, signature: sigInfo.signature, blockTime: tx.blockTime ?? null };
      try {
        for (const decoded of this.parser.parseLogs(tx.meta.logMessages, false)) {
          const ev: AutarkEvent = { ...meta, name: decoded.name as AutarkEventName, data: decoded.data as any };
          this._dispatch(ev);
        }
      } catch { /* malformed logs */ }
    }
  }

  private _dispatch(ev: AutarkEvent): void {
    const job = (ev.data as any).job as PublicKey | undefined;
    if (!job) return;
    const key = `${ev.name}:${job.toBase58()}`;
    const arr = this.waiters.get(key);
    if (arr?.length) {
      const waiter = arr.shift()!;
      waiter.resolve(ev);
    }
  }
}

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
      const delay = 2_000 * (i + 1);
      if (VERBOSE) _origLog(`[retry] ${label} attempt ${i + 2}/${tries} in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw new Error("unreachable");
}

async function usdcBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<number> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false);
  try { return (await conn.getTokenAccountBalance(ata)).value.uiAmount ?? 0; }
  catch { return 0; }
}

async function stakeVaultBalance(conn: Connection, agentAddr: PublicKey, mint: PublicKey): Promise<number> {
  const sv = stakeVault(agentAddr, mint);
  try { return (await conn.getTokenAccountBalance(sv)).value.uiAmount ?? 0; }
  catch { return 0; }
}

function fmtDelta(n: number): string {
  if (n > 0.005) return `${C.green}+${n.toFixed(2)}${C.reset}`;
  if (n < -0.005) return `${C.red}${n.toFixed(2)}${C.reset}`;
  return `0.00`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../devnet.config.json"), "utf-8")
  );
  const testMint = new PublicKey(config.testMint);
  const deployer = loadKeypair(
    process.env.WALLET_KEYPAIR_PATH ??
    path.join(process.env.HOME ?? "~", ".config/solana/id.json")
  );
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

  // ── Banner ─────────────────────────────────────────────────────────────────
  out();
  box("  AUTARK PROTOCOL  ·  LIVE DEMO  ", C.bgBlue + C.bold + C.white);
  out();
  out(`  ${C.dim}Program${C.reset}  ${config.programId}`);
  out(`  ${C.dim}RPC${C.reset}      ${rpcUrl}`);
  out(`  ${C.dim}Mint${C.reset}     ${testMint.toBase58()}`);
  out(`  ${C.dim}Date${C.reset}     ${new Date().toISOString().slice(0, 10)}`);
  out();
  if (rpcUrl.includes("api.devnet.solana.com")) {
    out(`  ${C.yellow}⚠  Public devnet RPC — may be slow. For on-stage reliability set:${C.reset}`);
    out(`  ${C.yellow}   SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<KEY>${C.reset}`);
    out();
  }

  // ── Fresh keypairs ─────────────────────────────────────────────────────────
  const honestKp   = Keypair.generate();
  const flakyKp    = Keypair.generate();
  const consumerKp = Keypair.generate();

  const directorClient = AutarkClient.fromKeypair(deployer);
  const consumerClient = AutarkClient.fromKeypair(consumerKp);
  const conn           = directorClient.connection;
  const bus            = new EventBus(directorClient.program);

  // ══════════════════════════════════════════════════════════════════════════
  // SETUP — fail loud here, never mid-demo
  // ══════════════════════════════════════════════════════════════════════════

  out(`${C.bold}▸ SETUP${C.reset}`);
  out();
  setupLine("Fresh wallets generated:");
  setupLine(`  honestAgent  ${honestKp.publicKey.toBase58()}`);
  setupLine(`  flakyAgent   ${flakyKp.publicKey.toBase58()}`);
  setupLine(`  consumer     ${consumerKp.publicKey.toBase58()}`);
  out();

  // Fund SOL in one transaction
  setupLine("Funding SOL…");
  {
    const lamports = Math.floor(0.15 * LAMPORTS_PER_SOL);
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: honestKp.publicKey,   lamports }),
      SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: flakyKp.publicKey,    lamports }),
      SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: consumerKp.publicKey, lamports })
    );
    const sig = await withRetry("fundSOL", () => conn.sendTransaction(tx, [deployer]));
    await conn.confirmTransaction(sig, "confirmed");
    setupLine("SOL funded (0.15 SOL each)  ✓");
  }

  // Create ATAs + mint USDC
  setupLine(`Minting ${SETUP_MINT_USDC} USDC to each wallet…`);
  for (const kp of [honestKp, flakyKp, consumerKp]) {
    const ata = await withRetry("createATA", () =>
      getOrCreateAssociatedTokenAccount(conn, deployer, testMint, kp.publicKey)
    );
    await withRetry("mintUSDC", () =>
      mintTo(conn, deployer, testMint, ata.address, deployer, SETUP_MINT_USDC * 1_000_000)
    );
  }
  setupLine("USDC minted  ✓");

  // Anthropic (optional — honestAgent falls back to canned result)
  const apiKey    = process.env.ANTHROPIC_API_KEY;
  const anthropic = apiKey ? new Anthropic({ apiKey }) : null;
  if (!anthropic) setupLine("⚠ ANTHROPIC_API_KEY not set — honestAgent uses canned response");

  // Create and start both agents
  setupLine("Registering and staking agents…");

  const honestAgent = new AutarkAgent({
    keypair:         honestKp,
    capabilities:    ["token-research"],
    endpointUrl:     "https://honest.autark.demo",
    mint:            testMint,
    minStake:        INITIAL_STAKE_USDC,
    pollIntervalMs:  POLL_INTERVAL_MS,

    async onJob(job) {
      const amtStr = (job.amount / 1_000_000).toFixed(2);
      if (anthropic) {
        try {
          const resp = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 80,
            messages: [{
              role: "user",
              content: `You are a Solana research agent fulfilling a ${amtStr} USDC job. ` +
                       `Two sentences of DeFi market commentary, no more.`,
            }],
          });
          return { deliver: true, result: (resp.content[0] as any).text as string };
        } catch { /* fallthrough to canned */ }
      }
      return {
        deliver: true,
        result: `On-chain flow analysis complete. Consumer ${job.consumer.toBase58().slice(0, 8)}… ` +
                `shows healthy DeFi activity with ${amtStr} USDC allocated to research.`,
      };
    },

    async onChallenged() { return "defend"; },
  });

  const flakyAgent = new AutarkAgent({
    keypair:        flakyKp,
    capabilities:   ["token-research"],
    endpointUrl:    "https://flaky.autark.demo",
    mint:           testMint,
    minStake:       INITIAL_STAKE_USDC,
    pollIntervalMs: POLL_INTERVAL_MS,

    async onJob() { return { deliver: true, result: "good" }; },

    async onChallenged() { return "concede"; }, // THE moment
  });

  await honestAgent.start();
  // Stagger by half a poll interval so both agents' getProgramAccounts calls
  // don't land in the same RPC window.
  await sleep(Math.floor(POLL_INTERVAL_MS / 2));
  await flakyAgent.start();
  setupLine("Both agents registered and polling  ✓");

  // Snapshot balances after registration (post-stake deduction)
  const honestPda = agentPda(honestKp.publicKey);
  const flakyPda  = agentPda(flakyKp.publicKey);

  const [hAtaStart, fAtaStart, hStakeStart, fStakeStart] = await Promise.all([
    usdcBalance(conn, honestKp.publicKey, testMint),
    usdcBalance(conn, flakyKp.publicKey, testMint),
    stakeVaultBalance(conn, honestPda, testMint),
    stakeVaultBalance(conn, flakyPda, testMint),
  ]);

  // Let the rate-limit bucket recover after the setup burst.
  // On a private RPC this is instantaneous; on public devnet it buys breathing room.
  setupLine("Cooling down after setup burst…");
  await sleep(12_000);

  // Warm the event bus (marks existing sigs as seen so only future events fire)
  setupLine("Warming event bus…");
  await bus.warmUp(50);
  bus.start();
  setupLine("Event bus live  ✓");

  _arcMode = true; // suppress AutarkAgent chatter from here on
  out();
  good(`${C.bold}SETUP OK${C.reset}  —  agents registered, event poller live, arc begins`);
  out();
  await pause();

  // ══════════════════════════════════════════════════════════════════════════
  // ACT 1 — HONEST AGENT
  // ══════════════════════════════════════════════════════════════════════════

  box("ACT 1  ·  HONEST AGENT  ·  The System Works", C.green);
  out();
  await pause();

  const jobAId  = crypto.randomBytes(32);
  const jobAPda = jobOfferPda(consumerKp.publicKey, jobAId);
  const now1    = Math.floor(Date.now() / 1000);
  const t1      = Date.now();

  beat(
    `Job A proposed → ${C.bold}honestAgent${C.reset}`,
    `${JOB_AMOUNT_USDC} USDC  ·  challenge window ${ACT1_CHALLENGE_WINDOW}s`
  );

  await withRetry("proposeJobA", () =>
    consumerClient.ix.proposeJob({
      jobId:                  jobAId,
      provider:               honestKp.publicKey,
      amount:                 JOB_AMOUNT_USDC,
      acceptanceDeadline:     now1 + 3600,
      deliveryDeadline:       now1 + 7200,
      challengeWindowSeconds: ACT1_CHALLENGE_WINDOW,
      defenseWindowSeconds:   ACT1_DEFENSE_WINDOW,
      mint:                   testMint,
    }).rpc()
  );

  {
    const ev = await bus.wait("jobProposed", jobAPda, ACT_TIMEOUT_MS);
    eventLine(ev, `${C.green}${JOB_AMOUNT_USDC} USDC escrowed${C.reset}`);
  }
  await pause();

  beat("honestAgent autonomously discovered the job and accepted it");
  {
    const ev = await bus.wait("jobAccepted", jobAPda, ACT_TIMEOUT_MS);
    eventLine(ev, `stake_locked=${(ev.data.stakeLocked.toNumber() / 1e6).toFixed(2)} USDC`);
  }
  await pause();

  beat("honestAgent delivered work and released escrow");
  {
    const ev = await bus.wait("settlementPendingEvent", jobAPda, ACT_TIMEOUT_MS);
    const t = new Date(ev.data.settleEligibleAt.toNumber() * 1000).toISOString().slice(11, 19);
    eventLine(ev, `settle eligible at ${t} UTC`);
  }
  beat(`Challenge window (${ACT1_CHALLENGE_WINDOW}s) open  —  no dispute filed`);
  await pause();

  beat("Challenge window closed  —  honestAgent self-claims");
  {
    const ev = await bus.wait("jobSettled", jobAPda, ACT_TIMEOUT_MS);
    const score   = ev.data.scoreCompleted.toNumber();
    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    eventLine(ev, `${C.green}${JOB_AMOUNT_USDC} USDC paid  ·  scoreCompleted 0 → ${score}${C.reset}`);
    out();
    good(`${C.bold}+${JOB_AMOUNT_USDC} USDC earned. Reputation rising.${C.reset}  (${elapsed}s)`);
  }
  out();
  await pause();

  // ══════════════════════════════════════════════════════════════════════════
  // ACT 2 — FLAKY AGENT
  // ══════════════════════════════════════════════════════════════════════════

  box("ACT 2  ·  FLAKY AGENT  ·  The Slash", C.red);
  out();
  await pause();

  const jobBId  = crypto.randomBytes(32);
  const jobBPda = jobOfferPda(consumerKp.publicKey, jobBId);
  const now2    = Math.floor(Date.now() / 1000);
  const t2      = Date.now();

  beat(
    `Job B proposed → ${C.bold}flakyAgent${C.reset}`,
    `${JOB_AMOUNT_USDC} USDC  ·  challenge window ${ACT2_CHALLENGE_WINDOW}s  ·  defense window ${ACT2_DEFENSE_WINDOW}s`
  );

  await withRetry("proposeJobB", () =>
    consumerClient.ix.proposeJob({
      jobId:                  jobBId,
      provider:               flakyKp.publicKey,
      amount:                 JOB_AMOUNT_USDC,
      acceptanceDeadline:     now2 + 3600,
      deliveryDeadline:       now2 + 7200,
      challengeWindowSeconds: ACT2_CHALLENGE_WINDOW,
      defenseWindowSeconds:   ACT2_DEFENSE_WINDOW,
      mint:                   testMint,
    }).rpc()
  );

  {
    const ev = await bus.wait("jobProposed", jobBPda, ACT_TIMEOUT_MS);
    eventLine(ev, `${C.yellow}${JOB_AMOUNT_USDC} USDC escrowed${C.reset}`);
  }
  await pause();

  beat("flakyAgent discovered the job and accepted it");
  {
    const ev = await bus.wait("jobAccepted", jobBPda, ACT_TIMEOUT_MS);
    eventLine(ev, `stake_locked=${(ev.data.stakeLocked.toNumber() / 1e6).toFixed(2)} USDC`);
  }
  await pause();

  beat(`flakyAgent "delivered" (low-effort) and released escrow`);
  {
    const spEv = await bus.wait("settlementPendingEvent", jobBPda, ACT_TIMEOUT_MS);
    const t = new Date(spEv.data.settleEligibleAt.toNumber() * 1000).toISOString().slice(11, 19);
    eventLine(spEv, `settle eligible at ${t} UTC  —  consumer disputes immediately`);
    await pause();

    // Event-driven: director challenges the instant SettlementPending lands
    beat(
      `${C.red}Consumer disputes the work  →  challenge opened${C.reset}`,
      `staking ${JOB_AMOUNT_USDC} USDC`
    );
    await withRetry("challengeSettlement", () =>
      consumerClient.ix.challengeSettlement({ jobId: jobBId, mint: testMint }).rpc()
    );

    const coEv = await bus.wait("challengeOpened", jobBPda, ACT_TIMEOUT_MS);
    const defDeadline    = coEv.data.defenseDeadline.toNumber();
    const defDeadlineStr = new Date(defDeadline * 1000).toISOString().slice(11, 19);
    eventLine(
      coEv,
      `${C.red}stake=${(coEv.data.amount.toNumber() / 1e6).toFixed(2)} USDC  ·  defend by ${defDeadlineStr} UTC${C.reset}`
    );
    out();
    await pause();

    beat(`flakyAgent ${C.red}${C.bold}CONCEDES${C.reset}  —  no defense submitted`);
    out();

    // Wait until defense deadline + 3s buffer, then crank resolve
    const waitMs = Math.max(0, (defDeadline * 1000 - Date.now()) + 3_000);
    if (waitMs > 500) {
      beat(`Waiting ${(waitMs / 1000).toFixed(0)}s for defense window to expire…`);
      await sleep(waitMs);
    }

    beat("Director cranks resolveChallenge  →  undefended branch  →  slash fires");
    await withRetry("resolveChallenge", () =>
      directorClient.ix.resolveChallenge({
        consumer:      consumerKp.publicKey,
        jobId:         jobBId,
        provider:      flakyKp.publicKey,
        challenger:    consumerKp.publicKey,
        mint:          testMint,
        consumerAgent: null,
      }).rpc()
    );

    const crEv    = await bus.wait("challengeResolved", jobBPda, ACT_TIMEOUT_MS);
    const slashed = (crEv.data.slashed.toNumber() / 1e6).toFixed(2);
    const refund  = (crEv.data.consumerRefund.toNumber() / 1e6).toFixed(2);
    const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
    eventLine(
      crEv,
      `${C.red}defended=false  slashed=${slashed} USDC  consumer_refund=${refund} USDC${C.reset}`
    );
    out();
    good(`${C.bold}flakyAgent slashed ${slashed} USDC  ·  consumer refunded ${refund} USDC${C.reset}  (${elapsed}s)`);
    out(`  ${C.red}${C.bold}The bad actor paid for it. Consumer made whole.${C.reset}`);
  }

  out();
  await pause();

  // ── Teardown ───────────────────────────────────────────────────────────────
  bus.stop();
  honestAgent.stop();
  flakyAgent.stop();
  _arcMode = false;

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY TABLE
  // ══════════════════════════════════════════════════════════════════════════

  box("SUMMARY", C.cyan);
  out();

  const [honestData, flakyData] = await Promise.all([
    fetchAgent(directorClient.program, honestPda),
    fetchAgent(directorClient.program, flakyPda),
  ]);

  const [hAtaEnd, fAtaEnd, hStakeEnd, fStakeEnd] = await Promise.all([
    usdcBalance(conn, honestKp.publicKey, testMint),
    usdcBalance(conn, flakyKp.publicKey, testMint),
    stakeVaultBalance(conn, honestPda, testMint),
    stakeVaultBalance(conn, flakyPda, testMint),
  ]);

  // Column widths
  const W = [13, 11, 8, 13, 16, 14];
  const ANSI = 9; // chars added by one color escape + reset

  function pad(s: string, w: number, extra = 0): string { return s.padEnd(w + extra); }

  const hdr = [
    pad("Agent",     W[0]),
    pad("Completed", W[1]),
    pad("Failed",    W[2]),
    pad("Slashes",   W[3]),
    pad("ATA Δ",     W[4]),
    pad("Stake Δ",   W[5]),
  ].join("  ");
  const div = W.map((w) => "─".repeat(w)).join("  ");

  out(`  ${C.bold}${hdr}${C.reset}`);
  out(`  ${div}`);

  function row(
    name: string,
    data: Awaited<ReturnType<typeof fetchAgent>>,
    ataDelta: number,
    stakeDelta: number,
  ): void {
    const cmpStr   = data.scoreCompleted > 0
      ? `${C.green}${data.scoreCompleted}${C.reset}` : `${data.scoreCompleted}`;
    const failStr  = data.scoreFailed    > 0
      ? `${C.red}${data.scoreFailed}${C.reset}`      : `${data.scoreFailed}`;
    const slashStr = data.slashEvents    > 0
      ? `${C.red}${data.slashEvents}${C.reset}`      : `${data.slashEvents}`;
    out(
      "  " +
      pad(name,    W[0])            + "  " +
      pad(cmpStr,  W[1], ANSI)      + "  " +
      pad(failStr, W[2], ANSI)      + "  " +
      pad(slashStr,W[3], ANSI)      + "  " +
      pad(fmtDelta(ataDelta)   + " USDC", W[4], ANSI) + "  " +
      pad(fmtDelta(stakeDelta) + " USDC", W[5], ANSI)
    );
  }

  row("honestAgent", honestData, hAtaEnd - hAtaStart, hStakeEnd - hStakeStart);
  row("flakyAgent",  flakyData,  fAtaEnd - fAtaStart, fStakeEnd - fStakeStart);

  out();
  out(`  ${C.dim}ATA Δ   = wallet token balance change during demo${C.reset}`);
  out(`  ${C.dim}Stake Δ = change in on-chain locked stake vault${C.reset}`);
  out();
  good(`${C.bold}DEMO COMPLETE${C.reset}`);
  out();
}

main().catch((e: any) => {
  _arcMode = false;
  out();
  out(`  ${C.red}${C.bold}✗ DEMO FAILED${C.reset}: ${e?.message ?? e}`);
  if (e?.logs) {
    out("  Program logs:");
    e.logs.forEach((l: string) => out(`    ${l}`));
  }
  if (VERBOSE) _origError(e);
  process.exit(1);
});
