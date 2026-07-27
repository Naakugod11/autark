/**
 * web/lib/chainCache.ts — the shared server-side chain reads, split by cost,
 * reused by every consumer (landing strip, agent profiles, OG images,
 * sitemap).
 *
 * Before this existed, each consumer had its own unstable_cache-wrapped
 * fetchAgents()/backfill() call. Agent profiles cached per-owner
 * (unstable_cache keys on the function's arguments), so every distinct
 * profile visited within the TTL window triggered its OWN full
 * backfill({limit:350}) even though all of them read the exact same
 * on-chain event log. That's the storm getEventRows() below kills: one
 * backfill per revalidate window, no matter how many profiles/landing hits
 * land inside it.
 *
 * Split into two caches (agents vs. event rows), not one, because most
 * consumers don't need the expensive part at all: profile identity/scores/
 * ranks, the OG image, and the sitemap only ever need the agent list —
 * never the 350-signature backfill, which only the landing page and a
 * profile's own history section actually read. getAgentsSnapshot() (cheap:
 * one fetchAgents + one fetchSlashingPool) is kept separate from
 * getEventRows() (expensive: backfill(350) + event→row) so a cold OG-image
 * or sitemap hit costs one account read, never a full backfill — verified
 * empirically: post-split, a cold profile load followed immediately by its
 * OG image dropped from ~34s (full independent backfill) to ~1s (agents-only).
 *
 * Everything cached here is plain data (strings/numbers/arrays) — PublicKey
 * and BN instances do NOT survive unstable_cache's persist round-trip (same
 * class-losing behavior documented for Map in the old agentProfile.ts), so
 * the raw→plain conversion (toBase58(), toNumber(), event→row) happens
 * before either result is handed to unstable_cache.
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getProgram, fetchAgents, fetchSlashingPool, type AgentData } from "./autark";
import { backfill, type AutarkEvent } from "./events";
import { identityFor } from "./identity";
import type { FeedRow } from "./economy";

// Single shared TTL for every server-rendered consumer. Devnet reads don't
// need to be fresher than this — the live terminal (websocket, browser-side)
// is the real-time surface; every server-rendered page is allowed to be up
// to this stale.
export const SNAPSHOT_REVALIDATE_SECONDS = 90;

// Wide enough to satisfy the hungriest consumer (agent profile history);
// landing only needs a ~24h slice out of the same window, so one fetch
// covers both — sharing costs nothing extra. Cut from 350 to 150 as part of
// Task 0 (429 storms) — see web/lib/events.ts's STREAM_BACKFILL_LIMIT
// comment for the batching investigation and why a smaller limit, not
// batching, is the real lever here.
const EVENT_BACKFILL_LIMIT = 150;

export type PlainAgent = {
  owner: string;
  pubkey: string;
  capabilities: string[];
  endpointUrl: string;
  stakeAmount: number;
  stakeVault: string;
  scoreCompleted: number;
  scoreFailed: number;
  scoreVolume: number;
  slashEvents: number;
  lastSlashSlot: number;
  createdAt: number;
  openJobs: number;
  bump: number;
};

export type SlashingPoolSnapshot = {
  totalSlashed: number;
  mint: string;
  vault: string;
} | null;

export type AgentsSnapshot = {
  agents: PlainAgent[];
  pool: SlashingPoolSnapshot;
};

export type EventRowsSnapshot = {
  // Chronological, oldest → newest (same order backfill() returns) — every
  // agent's activity, not filtered. Consumers derive their own view (a
  // profile filters by consumer/provider, landing sums recent "settled" rows).
  rows: FeedRow[];
  // True if the backfill's signature cap may have cut off older history —
  // carried through as-is to every consumer that used to compute this itself.
  truncated: boolean;
};

function toPlainAgent(a: AgentData): PlainAgent {
  return {
    owner: a.owner.toBase58(),
    pubkey: a.pubkey.toBase58(),
    capabilities: a.capabilities,
    endpointUrl: a.endpointUrl,
    stakeAmount: a.stakeAmount,
    stakeVault: a.stakeVault.toBase58(),
    scoreCompleted: a.scoreCompleted,
    scoreFailed: a.scoreFailed,
    scoreVolume: a.scoreVolume,
    slashEvents: a.slashEvents,
    lastSlashSlot: a.lastSlashSlot,
    createdAt: a.createdAt,
    openJobs: a.openJobs,
    bump: a.bump,
  };
}

function fmtUsdc(micro: number): string {
  return (micro / 1e6).toFixed(2);
}

type JobRef = { consumer: string; provider: string; amount: number };

function buildJobsMap(events: AutarkEvent[]): Map<string, JobRef> {
  const map = new Map<string, JobRef>();
  for (const e of events) {
    if (e.name === "jobProposed") {
      map.set(e.data.job.toBase58(), {
        consumer: e.data.consumer.toBase58(),
        provider: e.data.provider.toBase58(),
        amount: e.data.amount.toNumber(),
      });
    } else if (e.name === "bountyAwarded") {
      map.set(e.data.job.toBase58(), {
        consumer: e.data.poster.toBase58(),
        provider: e.data.provider.toBase58(),
        amount: e.data.price.toNumber(),
      });
    }
  }
  return map;
}

// Mirrors economy.ts's per-event row shape (state, headline, badge) exactly —
// economy.ts's handlers are closures over the live client-side store (fleet
// patching, totalSlashed accumulation) that only make sense inside a running
// subscription, so this is a deliberate, separate, pure copy for the
// server-side snapshot rather than a shared import.
function eventToRow(e: AutarkEvent, jobs: Map<string, JobRef>, nameOf: (pk?: string) => string): FeedRow | null {
  const base = { id: `${e.signature}:${e.name}`, slot: e.slot, signature: e.signature, ts: e.blockTime != null ? e.blockTime * 1000 : 0, kind: e.name };

  switch (e.name) {
    case "jobProposed": {
      const consumer = e.data.consumer.toBase58();
      const provider = e.data.provider.toBase58();
      const amount = e.data.amount.toNumber();
      return { ...base, state: "proposed", consumer, provider, amount, headline: `${nameOf(consumer)} → ${fmtUsdc(amount)} USDC → ${nameOf(provider)}`, badge: "PROPOSED" };
    }
    case "jobAccepted": {
      const provider = e.data.provider.toBase58();
      const ref = jobs.get(e.data.job.toBase58());
      const amount = e.data.amount.toNumber();
      return { ...base, state: "accepted", consumer: ref?.consumer, provider, amount, headline: `${nameOf(ref?.consumer)} → ${fmtUsdc(amount)} USDC → ${nameOf(provider)}`, badge: "ACCEPTED · ESCROW" };
    }
    case "settlementPendingEvent": {
      const provider = e.data.provider.toBase58();
      const ref = jobs.get(e.data.job.toBase58());
      return { ...base, state: "pending", consumer: ref?.consumer, provider, amount: ref?.amount, headline: `${nameOf(ref?.consumer)} → ${ref?.amount != null ? fmtUsdc(ref.amount) : "—"} USDC → ${nameOf(provider)}`, badge: "SETTLEMENT PENDING" };
    }
    case "jobSettled": {
      const provider = e.data.provider.toBase58();
      const ref = jobs.get(e.data.job.toBase58());
      const amount = e.data.amount.toNumber();
      return { ...base, state: "settled", consumer: ref?.consumer, provider, amount, headline: `${nameOf(ref?.consumer)} → ${fmtUsdc(amount)} USDC → ${nameOf(provider)}`, badge: "SETTLED" };
    }
    case "bountyPosted": {
      const poster = e.data.poster.toBase58();
      const maxAmount = e.data.maxAmount.toNumber();
      return { ...base, state: "bounty", consumer: poster, amount: maxAmount, headline: `${nameOf(poster)} posts bounty · ${e.data.capabilityRequired} · up to ${fmtUsdc(maxAmount)} USDC`, badge: "BOUNTY OPEN" };
    }
    case "bidSubmitted": {
      const bidder = e.data.bidder.toBase58();
      const price = e.data.price.toNumber();
      return { ...base, state: "bounty", provider: bidder, amount: price, headline: `${nameOf(bidder)} bids ${fmtUsdc(price)} USDC on open bounty`, badge: "BID" };
    }
    case "bountyAwarded": {
      const consumer = e.data.poster.toBase58();
      const provider = e.data.provider.toBase58();
      const amount = e.data.price.toNumber();
      return { ...base, state: "accepted", consumer, provider, amount, headline: `${nameOf(consumer)} → ${fmtUsdc(amount)} USDC → ${nameOf(provider)}`, badge: "BOUNTY AWARDED" };
    }
    case "challengeOpened": {
      const challenger = e.data.challenger.toBase58();
      const defender = e.data.defender.toBase58();
      const amount = e.data.amount.toNumber();
      const ref = jobs.get(e.data.job.toBase58());
      return { ...base, state: "challenged", consumer: challenger, provider: defender, amount: ref?.amount ?? amount, headline: `${nameOf(challenger)} challenges ${nameOf(defender)} · ${fmtUsdc(amount)} USDC at stake`, badge: "DISPUTE OPEN" };
    }
    case "challengeDefended": {
      const defender = e.data.defender.toBase58();
      return { ...base, state: "defended", provider: defender, amount: e.data.amount.toNumber(), headline: `${nameOf(defender)} defends the challenge · stake returned`, badge: "DEFENDED" };
    }
    case "challengeResolved": {
      const ref = jobs.get(e.data.job.toBase58());
      const provider = ref?.provider;
      const slashed = e.data.slashed.toNumber();
      const isSlash = !e.data.defended && slashed > 0;
      const row: FeedRow = {
        ...base,
        state: isSlash ? "slash" : "defended",
        consumer: ref?.consumer,
        provider,
        amount: ref?.amount,
        headline: isSlash
          ? `${nameOf(provider)} SLASHED · −${fmtUsdc(slashed)} USDC · challenge upheld`
          : `${nameOf(provider)} defended · challenge dismissed`,
        badge: isSlash ? "SLASHED" : "DEFENDED",
      };
      if (isSlash) row.slashed = slashed;
      return row;
    }
    case "jobRejected": {
      const provider = e.data.provider.toBase58();
      return { ...base, state: "rejected", provider, amount: e.data.refunded.toNumber(), headline: `${nameOf(provider)} rejected the job · consumer refunded`, badge: "REJECTED" };
    }
    case "jobExpired": {
      const provider = e.data.provider.toBase58();
      const slashed = e.data.slashed.toNumber();
      const isSlash = slashed > 0;
      const row: FeedRow = {
        ...base,
        state: isSlash ? "slash" : "expired",
        provider,
        amount: e.data.refunded.toNumber(),
        headline: isSlash ? `${nameOf(provider)} SLASHED · −${fmtUsdc(slashed)} USDC · delivery deadline missed` : `${nameOf(provider)} job expired · consumer refunded`,
        badge: isSlash ? "SLASHED" : "EXPIRED",
      };
      if (isSlash) row.slashed = slashed;
      return row;
    }
    case "jobAbandoned": {
      const provider = e.data.provider.toBase58();
      const slashed = e.data.slashed.toNumber();
      const isSlash = slashed > 0;
      const row: FeedRow = {
        ...base,
        state: isSlash ? "slash" : "abandoned",
        provider,
        amount: e.data.refunded.toNumber(),
        headline: isSlash ? `${nameOf(provider)} SLASHED · −${fmtUsdc(slashed)} USDC · job abandoned` : `${nameOf(provider)} abandoned the job`,
        badge: isSlash ? "SLASHED" : "ABANDONED",
      };
      if (isSlash) row.slashed = slashed;
      return row;
    }
    default:
      return null;
  }
}

// Task 0 (429 storms): `unstable_cache` revalidation isn't documented to
// single-flight concurrent cold/stale calls to the SAME key — nothing stops
// two requests that land in the same instance a moment apart, both seeing a
// stale/missing entry, from each calling the wrapped loader (and therefore
// each running their own backfill(150)) before either's result is cached.
// This wraps a cache()+unstable_cache()-wrapped function so, no matter how
// many concurrent callers ask for it, only ONE underlying call is ever in
// flight at a time per process — every other concurrent caller (rather than
// starting its own chain read) just awaits the same promise.
function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    if (!inflight) {
      inflight = fn().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}

async function loadAgentsSnapshot(): Promise<AgentsSnapshot> {
  const program = getProgram();
  const [rawAgents, pool] = await Promise.all([fetchAgents(program), fetchSlashingPool(program)]);

  return {
    agents: rawAgents.map(toPlainAgent),
    pool: pool ? { totalSlashed: pool.totalSlashed, mint: pool.mint.toBase58(), vault: pool.vault.toBase58() } : null,
  };
}

// Cheap: one getProgramAccounts-style read plus one account fetch. Used by
// every consumer that only needs agent identity/scores/ranks — profile
// account data, the OG image, the sitemap, and half of the landing stats.
export const getAgentsSnapshot = cache(
  singleFlight(unstable_cache(loadAgentsSnapshot, ["chain-agents-snapshot"], { revalidate: SNAPSHOT_REVALIDATE_SECONDS }))
);

async function loadEventRows(): Promise<EventRowsSnapshot> {
  const program = getProgram();
  const events = await backfill(program, { limit: EVENT_BACKFILL_LIMIT });

  // Headlines are baked into rows once, here, at snapshot time — every
  // consumer (landing, every profile) reads the same finished string, so
  // names must be resolved now rather than deferred to each caller.
  const nameOf = (pk?: string) => (pk ? identityFor(pk).name : "unknown");

  const jobs = buildJobsMap(events);
  const rows: FeedRow[] = [];
  for (const e of events) {
    const row = eventToRow(e, jobs, nameOf);
    if (row) rows.push(row);
  }

  return {
    rows,
    truncated: events.length > 0 && events.length >= EVENT_BACKFILL_LIMIT * 0.9,
  };
}

// Expensive: a 350-signature backfill (up to 350 getTransaction calls).
// Only the landing page and an agent's own history section need this —
// never the OG image or sitemap, so they never pay for it.
export const getEventRows = cache(
  singleFlight(unstable_cache(loadEventRows, ["chain-event-rows"], { revalidate: SNAPSHOT_REVALIDATE_SECONDS }))
);
