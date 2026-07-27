/**
 * web/lib/badgeInputs.ts — glue between THIS app's data shapes
 * (FleetAgent/FeedRow, web/lib/economy.ts) and badges.ts's derivation
 * functions. Kept separate from badges.ts on purpose: badges.ts prefigures
 * the paid reputation API and shouldn't know FeedRow exists, but every
 * surface in this app needs to turn its own live/cached data into the
 * inputs badges.ts expects — that adapter logic lives here instead.
 */

import type { FeedRow } from "./economy";
import type { ReputationInput, VanityInput } from "./badges";

// challengeDefended is the single on-chain event dedicated to "this
// defender won a dispute" — deliberately NOT also counting
// challengeResolved rows with defended=true, since that event can fire
// later to finalize/close the SAME dispute a challengeDefended row already
// recorded; counting both would double the survivor count for one real
// defense.
export function countChallengesDefended(feed: FeedRow[], owner: string): number {
  let count = 0;
  for (const row of feed) {
    if (row.kind === "challengeDefended" && row.provider === owner) count++;
  }
  return count;
}

export function hasBidOnBounty(feed: FeedRow[], owner: string): boolean {
  return feed.some((row) => row.kind === "bidSubmitted" && row.provider === owner);
}

// Deliberately order-independent (takes the max ts across matching rows)
// rather than assuming newest-first — callers pass feed arrays in both
// orders (economy.ts's live feed is newest-first; chainCache.ts's shared
// event rows are oldest-first), and a wrong assumption here would silently
// return the OLDEST activity instead of the most recent.
export function lastActivityTs(feed: FeedRow[], owner: string): number | null {
  let latest: number | null = null;
  for (const row of feed) {
    if (row.consumer !== owner && row.provider !== owner) continue;
    if (latest == null || row.ts > latest) latest = row.ts;
  }
  return latest;
}

// 1-based rank by on-chain registration time across ALL registered agents —
// computed once per render over the whole population, not per-agent, so
// callers should call this once and look up each owner's rank from the map.
export function computeRegistrationRanks(
  agents: { owner: string; createdAt: number }[]
): Map<string, number> {
  const sorted = [...agents].sort((a, b) => a.createdAt - b.createdAt);
  return new Map(sorted.map((a, i) => [a.owner, i + 1]));
}

export function buildReputationInput(
  agent: { scoreVolume: number; scoreCompleted: number; scoreFailed: number; slashEvents: number; owner: string },
  feed: FeedRow[]
): ReputationInput {
  return {
    scoreVolume: agent.scoreVolume,
    scoreCompleted: agent.scoreCompleted,
    slashEvents: agent.slashEvents,
    challengesDefended: countChallengesDefended(feed, agent.owner),
  };
}

export function buildVanityInput(
  owner: string,
  feed: FeedRow[],
  registrationRank: number
): VanityInput {
  return {
    registrationRank,
    lastActivityTs: lastActivityTs(feed, owner),
    hasBidOnBounty: hasBidOnBounty(feed, owner),
  };
}
