/**
 * web/app/api/demo/route.ts — "RUN DEMO" button backend.
 *
 * Drives the REAL propose → accept → deliver → dispute → slash arc on devnet
 * using a fixed, server-held provider+consumer keypair pair (never sent to
 * the browser — see scripts/setup-demo-agent.ts and .env.example). The
 * dashboard itself never signs anything; visitors just watch the existing
 * live event subscription render each transaction as it lands, exactly like
 * any organic on-chain activity.
 *
 * This is a Node.js route (not Edge) — it needs Buffer/fs (the IDL's JSON
 * import) and real signing, none of which run on the edge runtime.
 *
 * Compressed vs. scripts/demo.ts: that script runs TWO full acts (an honest
 * agent earning reputation, then a flaky one getting slashed) through a
 * polling AutarkAgent runtime, generating fresh keypairs every run — built
 * for an on-stage narrated demo, not a 60s serverless budget. This route
 * only runs the slash arc (the point of the button), issues each
 * instruction directly via web/lib/demoArc.ts instead of the AutarkAgent
 * polling abstraction (we hold both keypairs, so there's nothing to poll
 * for), and reuses one fixed identity pair forever instead of registering a
 * fresh agent per click.
 *
 * Lock + cooldown are read from on-chain state, not a database: the demo
 * provider's own `openJobs` counter is the "already running" lock (shared
 * and correct across every serverless instance/region — no separate store
 * needed), and `lastSlashSlot` converted to wall-clock time is the cooldown
 * clock. This does mean a near-simultaneous double-press has a small
 * TOCTOU race (both requests could read "idle" before either's proposeJob
 * lands) — acceptable for a low-traffic demo button: the loser just fails
 * its acceptJob against locked stake and surfaces a clear error, it doesn't
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
const CHALLENGE_WINDOW_SECONDS = 20;
const DEFENSE_WINDOW_SECONDS = 12;
const COOLDOWN_SECONDS = 150;
const APPROX_SLOT_SECONDS = 0.45;
const SOFT_DEADLINE_MS = 48_000; // abort with a clear message before Vercel kills the function at maxDuration

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

    const jobId = Array.from(crypto.randomBytes(32));
    const now = Math.floor(Date.now() / 1000);
    const signatures: Record<string, string> = {};

    if (timeLeft() < 20_000) throw new Error("RPC too slow right now — aborting before the propose step");
    signatures.proposeJob = await withRetry(() =>
      proposeJob(consumerProgram, consumerKp, {
        jobId,
        provider: providerKp.publicKey,
        amountUsdc: JOB_AMOUNT_USDC,
        acceptanceDeadline: now + 3600,
        deliveryDeadline: now + 7200,
        challengeWindowSeconds: CHALLENGE_WINDOW_SECONDS,
        defenseWindowSeconds: DEFENSE_WINDOW_SECONDS,
        mint,
      })
    );

    if (timeLeft() < 16_000) throw new Error("RPC too slow right now — job was proposed but the arc aborted before it could resolve; it will sit unaccepted until it expires");
    signatures.acceptJob = await withRetry(() =>
      acceptJob(providerProgram, providerKp, { consumer: consumerKp.publicKey, jobId })
    );

    if (timeLeft() < 14_000) throw new Error("RPC too slow right now — job was accepted but not delivered; it will expire on its own");
    signatures.releaseEscrow = await withRetry(() =>
      releaseEscrow(providerProgram, providerKp, { consumer: consumerKp.publicKey, jobId })
    );

    if (timeLeft() < 10_000) throw new Error("RPC too slow right now — delivered but not disputed; the flaky agent will self-claim as if it got away with it");
    signatures.challengeSettlement = await withRetry(() =>
      challengeSettlement(consumerProgram, consumerKp, { jobId, mint })
    );

    // The defense window must actually elapse on-chain before resolveChallenge's
    // undefended branch is valid — this is real wall-clock time, not something
    // any retry/backoff can shortcut. +3s buffer against clock skew, matching
    // scripts/demo.ts's own pattern.
    const waitMs = DEFENSE_WINDOW_SECONDS * 1000 + 3_000;
    if (timeLeft() < waitMs + 8_000) {
      throw new Error("RPC too slow right now — the dispute is open on-chain and will resolve once the defense window passes, but not within this request");
    }
    await new Promise((r) => setTimeout(r, waitMs));

    signatures.resolveChallenge = await withRetry(() =>
      resolveChallenge(consumerProgram, consumerKp, {
        consumer: consumerKp.publicKey,
        jobId,
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
