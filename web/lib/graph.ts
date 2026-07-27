/**
 * web/lib/graph.ts — pure derivation of the agent economic-interaction graph
 * from the SAME two data sources every other surface reads: the live fleet
 * (web/lib/economy.ts's FleetAgent[]) and the live feed (FeedRow[]).
 *
 * No separate fetch, no separate subscription — web/components/NetworkGraph.tsx
 * calls these on every render of the existing useEconomyContext() state, so
 * the graph is just another view of the one economy store (same constraint
 * every other Task in this pass preserves).
 *
 * What this can and can't show: message content, delivered work, and job
 * descriptions are NOT on-chain (see the data contract) — this graph is
 * strictly the economic interaction graph (who hired whom, how often, for
 * how much, and how it went), never an invented "communication" graph.
 */

import type { FleetAgent, FeedRow } from "./economy";
import { familyOf, type FeedFamily } from "./feedStyle";

export type GraphNode = {
  owner: string;
  agent: FleetAgent;
  radius: number;
};

export type GraphEdge = {
  id: string; // stable key for an unordered {a,b} pair
  a: string;
  b: string;
  hireCount: number;
  totalVolume: number; // micro-USDC, settled only — see header note below
  disputes: number;
  slashes: number;
  // The relationship's dominant family for styling — sticky toward the worst
  // outcome ever seen (a slash that happened once stays visible as a slash
  // edge forever after; a relationship doesn't get to quietly launder its
  // record back to "settled" once the dispute count is nonzero). Matches the
  // same "once slashed, permanently on the record" honesty as the shame rank
  // elsewhere in this app.
  dominantFamily: FeedFamily;
  lastEventTs: number;
  lastRowId: string;
};

const FAMILY_SEVERITY: Record<FeedFamily, number> = {
  pending: 0,
  settled: 1,
  dispute: 2,
  slash: 3,
};

function pairKey(x: string, y: string): string {
  return x < y ? `${x}::${y}` : `${y}::${x}`;
}

const MIN_RADIUS = 7;
const MAX_RADIUS = 26;

// Sized by stake + lifetime volume (sqrt-scaled so one whale agent doesn't
// visually swallow the graph) — matches the spec's "sized/styled by stake or
// lifetime volume" instruction.
export function buildGraphNodes(agents: FleetAgent[]): GraphNode[] {
  if (agents.length === 0) return [];
  const weights = agents.map((a) => Math.sqrt(Math.max(0, a.stakeAmount) + Math.max(0, a.scoreVolume)));
  const max = Math.max(...weights, 1);
  return agents.map((agent, i) => ({
    owner: agent.owner,
    agent,
    radius: MIN_RADIUS + (weights[i] / max) * (MAX_RADIUS - MIN_RADIUS),
  }));
}

// `totalVolume` counts only settled amounts (the same "volume" definition
// scoreVolume already uses on-chain) — a proposed-but-never-settled amount
// isn't money that actually moved between the two agents yet.
export function buildGraphEdges(feed: FeedRow[]): GraphEdge[] {
  const map = new Map<string, GraphEdge>();
  // feed is newest-first; walk oldest-first so lastEventTs/lastRowId end up
  // holding the true latest event once the loop finishes.
  for (let i = feed.length - 1; i >= 0; i--) {
    const row = feed[i];
    const { consumer, provider } = row;
    if (!consumer || !provider || consumer === provider) continue;

    const key = pairKey(consumer, provider);
    const family = familyOf(row.state);
    const isDispute = family === "dispute";
    const isSlash = family === "slash";
    const isHire = row.kind === "jobProposed" || row.kind === "bountyAwarded";
    const settledAmount = row.state === "settled" ? (row.amount ?? 0) : 0;

    const existing = map.get(key);
    if (existing) {
      existing.hireCount += isHire ? 1 : 0;
      existing.totalVolume += settledAmount;
      existing.disputes += isDispute ? 1 : 0;
      existing.slashes += isSlash ? 1 : 0;
      if (FAMILY_SEVERITY[family] >= FAMILY_SEVERITY[existing.dominantFamily]) {
        existing.dominantFamily = family;
      }
      existing.lastEventTs = row.ts;
      existing.lastRowId = row.id;
    } else {
      const [a, b] = consumer < provider ? [consumer, provider] : [provider, consumer];
      map.set(key, {
        id: key,
        a,
        b,
        hireCount: isHire ? 1 : 0,
        totalVolume: settledAmount,
        disputes: isDispute ? 1 : 0,
        slashes: isSlash ? 1 : 0,
        dominantFamily: family,
        lastEventTs: row.ts,
        lastRowId: row.id,
      });
    }
  }
  return Array.from(map.values());
}
