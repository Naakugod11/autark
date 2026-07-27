/**
 * web/lib/agentProfile.ts — derives /agent/[pubkey]'s data from the shared
 * chain caches (web/lib/chainCache.ts). No RPC call lives in this file.
 *
 * Split in two, matching chainCache.ts's own split by cost:
 *   - getAgentAccount(owner) — identity, scores, stake, all four ranks.
 *     Only needs getAgentsSnapshot() (cheap) — this is what generateMetadata
 *     and the OG image call, so neither pays for event-row processing.
 *   - getAgentHistory(owner) — this agent's slice of the shared row list.
 *     Needs getEventRows() too (the expensive 350-signature backfill) —
 *     only the profile page body calls this.
 *
 * Neither wraps unstable_cache itself: the expensive part (RPC + event→row
 * conversion) is already cached upstream in chainCache.ts, so per-owner
 * derivation here is cheap in-memory filtering/sorting. React's cache()
 * still dedupes repeat calls within one request (generateMetadata +
 * the page body both ask for the same owner).
 */

import { cache } from "react";
import { getAgentsSnapshot, getEventRows, type PlainAgent } from "./chainCache";
import { resolveIdentity, type AgentIdentity } from "./identity";
import { getIdentityOverrides } from "./identityOverrides";
import type { FeedRow, FleetAgent } from "./economy";
import { deriveReputationBadges, deriveVanityBadges, type ReputationBadge, type VanityBadge } from "./badges";
import { buildReputationInput, buildVanityInput, computeRegistrationRanks } from "./badgeInputs";

// ── Ranks ────────────────────────────────────────────────────────────────────

export type RankEntry = { rank: number; total: number };

export type AgentRanks = {
  volume: RankEntry;
  jobs: RankEntry;
  clean: RankEntry;
  shame: RankEntry;
};

function cleanScore(a: PlainAgent): number {
  const total = a.scoreCompleted + a.scoreFailed;
  return total === 0 ? 1 : a.scoreCompleted / total;
}

function computeRank(
  agents: PlainAgent[],
  owner: string,
  cmp: (a: PlainAgent, b: PlainAgent) => number
): RankEntry {
  const sorted = [...agents].sort(cmp);
  const idx = sorted.findIndex((a) => a.owner === owner);
  return { rank: idx === -1 ? sorted.length + 1 : idx + 1, total: sorted.length };
}

function computeRanks(agents: PlainAgent[], owner: string): AgentRanks {
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

async function loadAgentAccount(owner: string): Promise<AgentAccountProfile> {
  const [snapshot, overrides] = await Promise.all([getAgentsSnapshot(), getIdentityOverrides()]);
  const agents = snapshot.agents;
  const match = agents.find((a) => a.owner === owner);
  const identity = resolveIdentity(owner, overrides);
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
    pubkey: match.pubkey,
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
}

export const getAgentAccount = cache(loadAgentAccount);

function toFleetAgent(a: PlainAgent, overrides: import("./identity").IdentityOverridesManifest): FleetAgent {
  return {
    owner: a.owner,
    pubkey: a.pubkey,
    identity: resolveIdentity(a.owner, overrides),
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

// ── History ──────────────────────────────────────────────────────────────────

function rowInvolves(row: FeedRow, owner: string): boolean {
  return row.consumer === owner || row.provider === owner;
}

export type AgentHistory = {
  rows: FeedRow[]; // newest first, this agent's activity only
  agentsByOwner: Map<string, FleetAgent>;
  truncated: boolean; // true if the shared snapshot's signature cap may have cut off older history
};

async function loadAgentHistory(owner: string): Promise<AgentHistory> {
  const [agentsSnapshot, eventRows, overrides] = await Promise.all([
    getAgentsSnapshot(),
    getEventRows(),
    getIdentityOverrides(),
  ]);
  const agentsByOwner = new Map(agentsSnapshot.agents.map((a) => [a.owner, toFleetAgent(a, overrides)]));

  // eventRows.rows is chronological ascending (oldest → newest); reverse to
  // match the page's newest-first display.
  const rows = eventRows.rows.filter((r) => rowInvolves(r, owner)).reverse();

  return { rows, agentsByOwner, truncated: eventRows.truncated };
}

export const getAgentHistory = cache(loadAgentHistory);

// ── Badges (Task 3) ────────────────────────────────────────────────────────
//
// Unlike getAgentAccount (agents-snapshot only, cheap), this needs
// getEventRows() too — dispute-survivor and the vanity badges are derived
// from event history. That means calling this (from the profile page, the
// OG image, or the leaderboard) can pay the full backfill cost on a cold
// cache, same as the landing page already does — acceptable because it's
// the SAME shared, single-flighted, throttled cache every other consumer
// already warms (web/lib/chainCache.ts), not a second independent read.
export type AgentBadges = { reputation: ReputationBadge[]; vanity: VanityBadge[] };

async function loadAgentBadges(owner: string): Promise<AgentBadges> {
  const [agentsSnapshot, eventRows] = await Promise.all([getAgentsSnapshot(), getEventRows()]);
  const match = agentsSnapshot.agents.find((a) => a.owner === owner);
  if (!match) return { reputation: [], vanity: [] };

  const ranks = computeRegistrationRanks(agentsSnapshot.agents.map((a) => ({ owner: a.owner, createdAt: a.createdAt })));
  const registrationRank = ranks.get(owner) ?? 0;

  return {
    reputation: deriveReputationBadges(buildReputationInput(match, eventRows.rows)),
    vanity: deriveVanityBadges(buildVanityInput(owner, eventRows.rows, registrationRank)),
  };
}

export const getAgentBadges = cache(loadAgentBadges);
