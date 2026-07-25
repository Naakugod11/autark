/**
 * web/lib/agentProfile.ts — server-safe, one-shot data loader for
 * /agent/[pubkey]. No subscription: a cold direct visit (including a social
 * unfurl crawler hitting generateMetadata / opengraph-image) must render
 * real data without the main dashboard's live store ever having run.
 *
 * Split in two so the OG image (must be fast) never pays for event replay:
 *   - getAgentAccount(owner)  — single fetchAgents() call, gives identity,
 *     scores, stake, and all four leaderboard ranks. Used by generateMetadata,
 *     opengraph-image, and the page body.
 *   - getAgentHistory(owner)  — backfill()'s the event log and filters to
 *     this agent's activity. Slower (still parallelized), page body only.
 *
 * Row construction intentionally mirrors web/lib/economy.ts's event handlers
 * rather than importing from them — economy.ts's handlers are closures over
 * live refs (fleet patching, totalSlashed accumulation) that only make sense
 * inside the running subscription. Duplicating the pure headline/state logic
 * here is a few dozen lines; refactoring the proven live pipeline to share it
 * is not worth the risk.
 */

import { cache } from "react";
import { getProgram, fetchAgents, type AgentData } from "./autark";
import { backfill, type AutarkEvent } from "./events";
import { identityFor, type AgentIdentity } from "./identity";
import type { FeedRow, FleetAgent } from "./economy";

// ── Ranks ────────────────────────────────────────────────────────────────────

export type RankEntry = { rank: number; total: number };

export type AgentRanks = {
  volume: RankEntry;
  jobs: RankEntry;
  clean: RankEntry;
  shame: RankEntry;
};

function cleanScore(a: AgentData): number {
  const total = a.scoreCompleted + a.scoreFailed;
  return total === 0 ? 1 : a.scoreCompleted / total;
}

function computeRank(
  agents: AgentData[],
  owner: string,
  cmp: (a: AgentData, b: AgentData) => number
): RankEntry {
  const sorted = [...agents].sort(cmp);
  const idx = sorted.findIndex((a) => a.owner.toBase58() === owner);
  return { rank: idx === -1 ? sorted.length + 1 : idx + 1, total: sorted.length };
}

function computeRanks(agents: AgentData[], owner: string): AgentRanks {
  return {
    volume: computeRank(agents, owner, (a, b) => b.scoreVolume - a.scoreVolume),
    jobs: computeRank(agents, owner, (a, b) => b.scoreCompleted - a.scoreCompleted),
    clean: computeRank(
      agents,
      owner,
      (a, b) =>
        a.slashEvents - b.slashEvents ||
        cleanScore(b) - cleanScore(a) ||
        b.scoreCompleted - a.scoreCompleted
    ),
    shame: computeRank(
      agents,
      owner,
      (a, b) => b.slashEvents - a.slashEvents || b.scoreFailed - a.scoreFailed || b.scoreVolume - a.scoreVolume
    ),
  };
}

// ── Account profile ────────────────────────────────────────────────────────────

export type AgentAccountProfile = {
  found: boolean;
  owner: string;
  pubkey: string | null;
  identity: AgentIdentity;
  capabilities: string[];
  endpointUrl: string;
  stakeAmount: number;
  scoreCompleted: number;
  scoreFailed: number;
  scoreVolume: number;
  slashEvents: number;
  lastSlashSlot: number;
  openJobs: number;
  createdAt: number;
  ranks: AgentRanks;
};

export const getAgentAccount = cache(async (owner: string): Promise<AgentAccountProfile> => {
  const program = getProgram();
  const agents = await fetchAgents(program);
  const match = agents.find((a) => a.owner.toBase58() === owner);
  const identity = identityFor(owner);
  const ranks = computeRanks(agents, owner);

  if (!match) {
    return {
      found: false,
      owner,
      pubkey: null,
      identity,
      capabilities: [],
      endpointUrl: "",
      stakeAmount: 0,
      scoreCompleted: 0,
      scoreFailed: 0,
      scoreVolume: 0,
      slashEvents: 0,
      lastSlashSlot: 0,
      openJobs: 0,
      createdAt: 0,
      ranks,
    };
  }

  return {
    found: true,
    owner,
    pubkey: match.pubkey.toBase58(),
    identity,
    capabilities: match.capabilities,
    endpointUrl: match.endpointUrl,
    stakeAmount: match.stakeAmount,
    scoreCompleted: match.scoreCompleted,
    scoreFailed: match.scoreFailed,
    scoreVolume: match.scoreVolume,
    slashEvents: match.slashEvents,
    lastSlashSlot: match.lastSlashSlot,
    openJobs: match.openJobs,
    createdAt: match.createdAt,
    ranks,
  };
});

// Full fleet, for resolving *other* agents' names inside this agent's history
// (e.g. who hired them). cache()'d separately so getAgentAccount's own
// fetchAgents() call is reused instead of duplicated within one request.
const getAllAgents = cache(async (): Promise<AgentData[]> => {
  return fetchAgents(getProgram());
});

// ── History ──────────────────────────────────────────────────────────────────

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
// see module doc for why this is a separate, pure copy.
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

function rowInvolves(row: FeedRow, owner: string): boolean {
  return row.consumer === owner || row.provider === owner;
}

export type AgentHistory = {
  rows: FeedRow[]; // newest first, this agent's activity only
  agentsByOwner: Map<string, FleetAgent>;
  truncated: boolean; // true if backfill's signature cap may have cut off older history
};

function toFleetAgent(a: AgentData): FleetAgent {
  const owner = a.owner.toBase58();
  return {
    owner,
    pubkey: a.pubkey.toBase58(),
    identity: identityFor(owner),
    capabilities: a.capabilities,
    stakeAmount: a.stakeAmount,
    scoreCompleted: a.scoreCompleted,
    scoreFailed: a.scoreFailed,
    scoreVolume: a.scoreVolume,
    slashEvents: a.slashEvents,
    lastSlashSlot: a.lastSlashSlot,
    openJobs: a.openJobs,
    createdAt: a.createdAt,
  };
}

export const getAgentHistory = cache(async (owner: string): Promise<AgentHistory> => {
  const program = getProgram();
  const allAgents = await getAllAgents();
  const agentsByOwner = new Map(allAgents.map((a) => [a.owner.toBase58(), toFleetAgent(a)]));
  const nameOf = (pk?: string) => (pk ? (agentsByOwner.get(pk)?.identity.name ?? identityFor(pk).name) : "unknown");

  const SIG_LIMIT = 350;
  const events = await backfill(program, { limit: SIG_LIMIT });
  const jobs = buildJobsMap(events);

  const rows: FeedRow[] = [];
  for (const e of events) {
    const row = eventToRow(e, jobs, nameOf);
    if (row && rowInvolves(row, owner)) rows.push(row);
  }
  rows.reverse(); // newest first

  return { rows, agentsByOwner, truncated: events.length > 0 && events.length >= SIG_LIMIT * 0.9 };
});
