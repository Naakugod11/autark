/**
 * web/app/api/demo/route.ts — "RUN DEMO" button backend.
 *
 * v2 (Task 5): drives TWO real jobs back-to-back on devnet, using the same
 * fixed, server-held provider+consumer keypair pair (never sent to the
 * browser — see scripts/setup-demo-agent.ts and .env.example):
 *
 *   Job A — propose → accept → deliver → (wait out the challenge window,
 *   undisputed) → claimSettlement. A real settlement: provider gets paid,
 *   scoreVolume goes up, 24H VOLUME on the landing strip moves.
 *
 *   Job B — propose → accept → deliver → dispute → (wait out the defense
 *   window, undefended) → resolveChallenge. The original slash arc: the
 *   provider loses its stake, TOTAL SLASHED moves.
 *
 * v1 only ever ran the slash arc, so a visitor watching the demo saw
 * punishment with no payoff and 24H VOLUME never moved. Running settle
 * first means a watching visitor sees settle-green land, then — moments
 * later — slash-red, inside one button press. The dashboard itself never
 * signs anything; visitors just watch the existing live event subscription
 * render each transaction as it lands, exactly like any organic on-chain
 * activity.
 *
 * This is a Node.js route (not Edge) — it needs Buffer/fs (the IDL's JSON
 * import) and real signing, none of which run on the edge runtime.
 *
 * Compressed vs. scripts/demo.ts: that script runs its two acts through a
 * polling AutarkAgent runtime, generating fresh keypairs every run — built
 * for an on-stage narrated demo, not a serverless time budget. This route
 * issues each instruction directly via web/lib/demoArc.ts instead of the
 * AutarkAgent polling abstraction (we hold both keypairs, so there's
 * nothing to poll for), and reuses one fixed identity pair forever instead
 * of registering a fresh agent per click.
 *
 * Lock + cooldown are read from on-chain state, not a database: the demo
 * provider's own `openJobs` counter is the "already running" lock (shared
 * and correct across every serverless instance/region — no separate store
 * needed; both jobs run strictly sequentially within one request, so
 * `openJobs` returns to 0 after job A settles before job B's acceptJob ever
 * increments it again), and `lastSlashSlot` converted to wall-clock time is
 * the cooldown clock (only job B ever sets it — job A never slashes). This
 * does mean a near-simultaneous double-press has a small TOCTOU race (both
 * requests could read "idle" before either's proposeJob lands) —
 * acceptable for a low-traffic demo button: the loser just fails its
 * acceptJob against locked stake and surfaces a clear error, it doesn't
 * corrupt anything.
 */

import { NextResponse } from "next/server";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as crypto from "crypto";
import { agentPda } from "../../../../sdk/src/pdas";
import { fetchAgent, type AgentData } from "../../../../sdk/src/types";
import {
  signingProgram,
  proposeJob,
  acceptJob,
  releaseEscrow,
  claimSettlement,
  challengeSettlement,
  resolveChallenge,
} from "@/lib/demoArc";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Devnet program's testMint is fixed for this deployment (same as
// PROGRAM_ID, hardcoded the same way sdk/src/pdas.ts hardcodes PROGRAM_ID)
// — devnet.config.json is a local/gitignored seeding artifact, not
// something a fresh deploy has.
const DEFAULT_TEST_MINT = "22Hs7sbpW72QhdWzgNajukC4QS1iAJE951ecjoz36FoF";

const JOB_AMOUNT_USDC = 1; // small — the provider's stake drains a little on every real slash
// Job A (settle) needs no real dispute window — nobody's going to challenge
// it — just enough that claimSettlement's on-chain check (now >=
// settle_eligible_at) has unambiguously passed by the time we crank it.
// Kept short so the two-job arc still fits the soft deadline below.
const SETTLE_CHALLENGE_WINDOW_SECONDS = 6;
const CHALLENGE_WINDOW_SECONDS = 20; // job B's window — long enough that the immediate challengeSettlement below is always safely inside it
const DEFENSE_WINDOW_SECONDS = 12;
const COOLDOWN_SECONDS = 150;
const APPROX_SLOT_SECONDS = 0.45;
// Abort with a clear message before Vercel kills the function at
// maxDuration — raised from v1's 48s to cover job A's extra propose/
// accept/release/claim round trip plus its own short wait.
const SOFT_DEADLINE_MS = 50_000;

type DemoStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "cooldown"; secondsRemaining: number }
  | { state: "unconfigured"; reason: string }
  | { state: "unfunded"; reason: string };

function loadDemoKeypair(envVar: string): Keypair {
  const raw = process.env[envVar];
  if (!raw) throw new Error(`${envVar} is not set`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function getTestMint(): PublicKey {
  return new PublicKey(process.env.DEMO_MINT ?? DEFAULT_TEST_MINT);
}

function getRpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not set");
  return url;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === tries - 1) throw e;
      const msg = String((e as Error)?.message ?? e);
      const transient = /429|Blockhash not found|block height exceeded|timeout|503/.test(msg);
      if (!transient) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

async function usdcBalance(connection: import("@solana/web3.js").Connection, owner: PublicKey, mint: PublicKey): Promise<number> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false);
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

async function computeStatus(): Promise<DemoStatus> {
  let providerKp: Keypair, consumerKp: Keypair;
  try {
    providerKp = loadDemoKeypair("DEMO_PROVIDER_KEYPAIR");
    consumerKp = loadDemoKeypair("DEMO_CONSUMER_KEYPAIR");
  } catch (e) {
    return { state: "unconfigured", reason: (e as Error).message };
  }

  let rpcUrl: string;
  try {
    rpcUrl = getRpcUrl();
  } catch (e) {
    return { state: "unconfigured", reason: (e as Error).message };
  }

  const program = signingProgram(providerKp, rpcUrl);
  const connection = program.provider.connection;
  const mint = getTestMint();

  const providerAddr = agentPda(providerKp.publicKey);
  let agent: AgentData;
  try {
    agent = await fetchAgent(program, providerAddr);
  } catch {
    return { state: "unconfigured", reason: "demo provider agent isn't registered on-chain — run scripts/setup-demo-agent.ts" };
  }

  if (agent.openJobs > 0) return { state: "running" };

  const [slot, providerSol, consumerSol, consumerUsdc] = await Promise.all([
    connection.getSlot(),
    connection.getBalance(providerKp.publicKey),
    connection.getBalance(consumerKp.publicKey),
    usdcBalance(connection, consumerKp.publicKey, mint),
  ]);

  const MIN_SOL = 0.01 * 1e9;
  if (providerSol < MIN_SOL || consumerSol < MIN_SOL) {
    return { state: "unfunded", reason: "demo wallet is low on devnet SOL for transaction fees" };
  }
  const freeStake = agent.stakeAmount; // openJobs is 0 here, so full stake is free
  if (freeStake < JOB_AMOUNT_USDC * 1_000_000 * 2 || consumerUsdc < JOB_AMOUNT_USDC) {
    return { state: "unfunded", reason: "demo agent's stake (or consumer's USDC) is too low — needs a top-up" };
  }

  const slotsSinceSlash = agent.lastSlashSlot > 0 ? slot - agent.lastSlashSlot : Infinity;
  const secondsSinceSlash = slotsSinceSlash * APPROX_SLOT_SECONDS;
  if (secondsSinceSlash < COOLDOWN_SECONDS) {
    return { state: "cooldown", secondsRemaining: Math.ceil(COOLDOWN_SECONDS - secondsSinceSlash) };
  }

  return { state: "idle" };
}

export async function GET() {
  try {
    const status = await computeStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ state: "unconfigured", reason: (e as Error).message } satisfies DemoStatus, { status: 500 });
  }
}

export async function POST() {
  const started = Date.now();
  const timeLeft = () => SOFT_DEADLINE_MS - (Date.now() - started);

  const status = await computeStatus().catch((e) => ({ state: "unconfigured" as const, reason: (e as Error).message }));
  if (status.state !== "idle") {
    return NextResponse.json({ ok: false, status }, { status: 409 });
  }

  try {
    const providerKp = loadDemoKeypair("DEMO_PROVIDER_KEYPAIR");
    const consumerKp = loadDemoKeypair("DEMO_CONSUMER_KEYPAIR");
    const rpcUrl = getRpcUrl();
    const mint = getTestMint();

    const providerProgram = signingProgram(providerKp, rpcUrl);
    const consumerProgram = signingProgram(consumerKp, rpcUrl);

    const signatures: Record<string, string> = {};

    // ── Job A — deliver honestly, settle (real volume) ────────────────────
    const jobIdA = Array.from(crypto.randomBytes(32));
    const nowA = Math.floor(Date.now() / 1000);

    if (timeLeft() < 44_000) throw new Error("RPC too slow right now — aborting before job A (the settle arc) even begins");
    signatures.proposeJobA = await withRetry(() =>
      proposeJob(consumerProgram, consumerKp, {
        jobId: jobIdA,
        provider: providerKp.publicKey,
        amountUsdc: JOB_AMOUNT_USDC,
        acceptanceDeadline: nowA + 3600,
        deliveryDeadline: nowA + 7200,
        challengeWindowSeconds: SETTLE_CHALLENGE_WINDOW_SECONDS,
        defenseWindowSeconds: DEFENSE_WINDOW_SECONDS,
        mint,
      })
    );

    if (timeLeft() < 40_000) throw new Error("RPC too slow right now — job A was proposed but the arc aborted before it could be accepted; it will sit unaccepted until it expires");
    signatures.acceptJobA = await withRetry(() =>
      acceptJob(providerProgram, providerKp, { consumer: consumerKp.publicKey, jobId: jobIdA })
    );

    if (timeLeft() < 36_000) throw new Error("RPC too slow right now — job A was accepted but not delivered; it will expire on its own");
    signatures.releaseEscrowA = await withRetry(() =>
      releaseEscrow(providerProgram, providerKp, { consumer: consumerKp.publicKey, jobId: jobIdA })
    );

    // Job A's challenge window must actually elapse on-chain before
    // claimSettlement's check (now >= settle_eligible_at) passes — real
    // wall-clock time, not something retry/backoff can shortcut. +3s buffer
    // against clock skew, matching scripts/demo.ts's own pattern.
    const waitAMs = SETTLE_CHALLENGE_WINDOW_SECONDS * 1000 + 3_000;
    if (timeLeft() < waitAMs + 8_000) {
      throw new Error("RPC too slow right now — job A was delivered but the arc aborted before it could be claimed; it will sit claimable once its challenge window passes");
    }
    await new Promise((r) => setTimeout(r, waitAMs));

    signatures.claimSettlement = await withRetry(() =>
      claimSettlement(providerProgram, providerKp, {
        consumer: consumerKp.publicKey,
        jobId: jobIdA,
        providerWallet: providerKp.publicKey,
        mint,
      })
    );

    // ── Job B — deliver, get disputed, undefended -> slash ─────────────────
    const jobIdB = Array.from(crypto.randomBytes(32));
    const nowB = Math.floor(Date.now() / 1000);

    if (timeLeft() < 30_000) throw new Error("RPC too slow right now — job A settled but the arc aborted before job B (the slash arc) could begin");
    signatures.proposeJobB = await withRetry(() =>
      proposeJob(consumerProgram, consumerKp, {
        jobId: jobIdB,
        provider: providerKp.publicKey,
        amountUsdc: JOB_AMOUNT_USDC,
        acceptanceDeadline: nowB + 3600,
        deliveryDeadline: nowB + 7200,
        challengeWindowSeconds: CHALLENGE_WINDOW_SECONDS,
        defenseWindowSeconds: DEFENSE_WINDOW_SECONDS,
        mint,
      })
    );

    if (timeLeft() < 26_000) throw new Error("RPC too slow right now — job B was proposed but the arc aborted before it could be accepted; it will sit unaccepted until it expires");
    signatures.acceptJobB = await withRetry(() =>
      acceptJob(providerProgram, providerKp, { consumer: consumerKp.publicKey, jobId: jobIdB })
    );

    if (timeLeft() < 22_000) throw new Error("RPC too slow right now — job B was accepted but not delivered; it will expire on its own");
    signatures.releaseEscrowB = await withRetry(() =>
      releaseEscrow(providerProgram, providerKp, { consumer: consumerKp.publicKey, jobId: jobIdB })
    );

    if (timeLeft() < 18_000) throw new Error("RPC too slow right now — job B was delivered but not disputed; the flaky agent will self-claim as if it got away with it");
    signatures.challengeSettlement = await withRetry(() =>
      challengeSettlement(consumerProgram, consumerKp, { jobId: jobIdB, mint })
    );

    // Job B's defense window must actually elapse on-chain before
    // resolveChallenge's undefended branch is valid — same real-wall-clock
    // constraint as job A's wait above.
    const waitBMs = DEFENSE_WINDOW_SECONDS * 1000 + 3_000;
    if (timeLeft() < waitBMs + 8_000) {
      throw new Error("RPC too slow right now — job B's dispute is open on-chain and will resolve once the defense window passes, but not within this request");
    }
    await new Promise((r) => setTimeout(r, waitBMs));

    signatures.resolveChallenge = await withRetry(() =>
      resolveChallenge(consumerProgram, consumerKp, {
        consumer: consumerKp.publicKey,
        jobId: jobIdB,
        provider: providerKp.publicKey,
        challenger: consumerKp.publicKey,
        mint,
      })
    );

    return NextResponse.json({ ok: true, signatures });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
