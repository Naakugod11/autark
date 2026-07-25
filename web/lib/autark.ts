/**
 * web/lib/autark.ts — Browser-safe Autark read client.
 *
 * Deliberately browser-only: no fs, no Keypair, no signing.
 * RPC from NEXT_PUBLIC_SOLANA_RPC_URL (Helius devnet recommended).
 *
 * What was COPIED here from sdk/src/types.ts and why:
 *   - AgentData, JobOfferData types and their decode helpers (parseEnum, bn, bnOpt)
 *     The SDK's index.ts re-exports from client.ts, which imports sdk/src/client.ts,
 *     which in turn does `fs.readFileSync(idl.json)` — a hard Node-only dep.
 *     Rather than import from the SDK entry point, we copy the 30-line type/decode
 *     block here and import the IDL JSON directly.
 *
 * Events:
 *   sdk/src/events.ts only uses getSignaturesForAddress / connection.onLogs —
 *   both browser-safe. BUT importing it pulls in sdk/src/index.ts which reaches
 *   client.ts + the fs-based IDL load. TODO: once the SDK has a separate
 *   events-only entry point, re-export from here.
 */

import idl from "../../target/idl/autark.json";
import type { Autark } from "../../target/types/autark";
import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@anchor-lang/core";
import type { Transaction, VersionedTransaction } from "@solana/web3.js";

// ── Connection ─────────────────────────────────────────────────────────────────
//
// No silent fallback to public devnet: a production deploy that forgets to
// set NEXT_PUBLIC_SOLANA_RPC_URL would otherwise work — just quietly,
// slowly, and rate-limited for every visitor — which is worse than an
// obvious failure. If you actually want public devnet, set the env var to
// https://api.devnet.solana.com explicitly (see web/.env.example).

export function getRpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SOLANA_RPC_URL is not set — the dashboard has nothing to connect to."
    );
  }
  return url;
}

export function getConnection(): Connection {
  return new Connection(getRpcUrl(), "confirmed");
}

// ── Read-only Program ──────────────────────────────────────────────────────────
// AnchorProvider requires a wallet shape, but read-only calls (account.*.all())
// never invoke sign — the dummy wallet is never called.

const _dummyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
};

export function getProgram(): Program<Autark> {
  const provider = new AnchorProvider(getConnection(), _dummyWallet, {
    commitment: "confirmed",
  });
  // IDL address field drives programId; no separate arg in Anchor 1.0.
  return new Program<Autark>(idl as unknown as Autark, provider);
}

// ── Types (copied from sdk/src/types.ts — see header for rationale) ────────────

export type JobStatus =
  | "proposed" | "countered" | "accepted" | "settlementPending"
  | "challenged" | "settled" | "rejected" | "expired" | "abandoned" | "burned";

export type AgentData = {
  pubkey: PublicKey;
  owner: PublicKey;
  capabilities: string[];
  endpointUrl: string;
  stakeAmount: number;
  stakeVault: PublicKey;
  scoreCompleted: number;
  scoreFailed: number;
  scoreVolume: number;
  slashEvents: number;
  lastSlashSlot: number;
  createdAt: number;
  openJobs: number;
  bump: number;
};

export type JobOfferData = {
  pubkey: PublicKey;
  consumer: PublicKey;
  provider: PublicKey;
  mint: PublicKey;
  amount: number;
  status: JobStatus;
  acceptanceDeadline: number;
  deliveryDeadline: number;
  challengeWindowSeconds: number;
  settlementPendingAt: number | null;
  createdAt: number;
  jobId: number[];
};

// ── Decode helpers ─────────────────────────────────────────────────────────────

function parseEnum<T extends string>(raw: unknown): T {
  return Object.keys(raw as Record<string, unknown>)[0] as T;
}

function bn(v: unknown): number {
  return (v as BN).toNumber();
}

function bnOpt(v: unknown): number | null {
  return v == null ? null : bn(v);
}

// ── Fetchers ───────────────────────────────────────────────────────────────────

export async function fetchAgents(program?: Program<Autark>): Promise<AgentData[]> {
  const p = program ?? getProgram();
  const all = await p.account.agent.all();
  return all.map((a) => {
    const r: any = a.account;
    return {
      pubkey: a.publicKey,
      owner: r.owner,
      capabilities: r.capabilities as string[],
      endpointUrl: r.endpointUrl as string,
      stakeAmount: bn(r.stakeAmount),
      stakeVault: r.stakeVault,
      scoreCompleted: bn(r.scoreCompleted),
      scoreFailed: bn(r.scoreFailed),
      scoreVolume: bn(r.scoreVolume),
      slashEvents: r.slashEvents as number,
      lastSlashSlot: bn(r.lastSlashSlot),
      createdAt: bn(r.createdAt),
      openJobs: r.openJobs as number,
      bump: r.bump as number,
    };
  });
}

export async function fetchRecentJobs(
  program?: Program<Autark>,
  limit = 20
): Promise<JobOfferData[]> {
  const p = program ?? getProgram();
  const all = await p.account.jobOffer.all();
  // Sort newest-first by createdAt, cap at limit
  return all
    .map((a) => {
      const r: any = a.account;
      return {
        pubkey: a.publicKey,
        consumer: r.consumer,
        provider: r.provider,
        mint: r.mint,
        amount: bn(r.amount),
        status: parseEnum<JobStatus>(r.status),
        acceptanceDeadline: bn(r.acceptanceDeadline),
        deliveryDeadline: bn(r.deliveryDeadline),
        challengeWindowSeconds: r.challengeWindowSeconds as number,
        settlementPendingAt: bnOpt(r.settlementPendingAt),
        createdAt: bn(r.createdAt),
        jobId: Array.from(r.jobId as number[]),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function fetchSlashingPool(
  program?: Program<Autark>
): Promise<{ totalSlashed: number; mint: PublicKey; vault: PublicKey } | null> {
  const p = program ?? getProgram();
  const all = await p.account.slashingPool.all();
  if (all.length === 0) return null;
  const r: any = all[0].account;
  return {
    totalSlashed: bn(r.totalSlashed),
    mint: r.mint,
    vault: r.vault,
  };
}

// ── Events TODO ────────────────────────────────────────────────────────────────
// sdk/src/events.ts is browser-safe (uses getSignaturesForAddress + connection.onLogs
// — no fs, no Keypair). But importing it through the SDK entry point (sdk/src/index.ts)
// pulls in client.ts → fs.readFileSync(idl). TODO: add an events-only re-export to
// the SDK, then re-export it here. For now, callers can use EventParser directly:
//
//   import { EventParser, BorshCoder } from "@anchor-lang/core";
//   import idl from "../../target/idl/autark.json";
//   const parser = new EventParser(PROGRAM_ID, new BorshCoder(idl));
//   for (const ev of parser.parseLogs(tx.meta.logMessages, false)) { ... }
