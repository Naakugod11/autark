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
import { identityFor } from "./identity";

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
  // True when the MOST RECENT event on this pair is a still-open job (a job
  // that's been proposed/accepted/awarded/put in settlement-pending, or a
  // dispute that hasn't resolved yet) rather than a terminal outcome —
  // drives the graph's "active right now" marching-dash treatment. This is
  // about recency, not severity, so it's tracked independently of
  // dominantFamily (a pair can be dominantFamily "slash" from history while
  // ALSO currently having a fresh in-flight job open).
  hasOpenJob: boolean;
};

const FAMILY_SEVERITY: Record<FeedFamily, number> = {
  pending: 0,
  settled: 1,
  dispute: 2,
  slash: 3,
};

// Event kinds that represent a job/dispute still being worked through, as
// opposed to a terminal outcome (settled/rejected/expired/abandoned/resolved).
const IN_FLIGHT_KINDS = new Set<FeedRow["kind"]>([
  "jobProposed",
  "jobAccepted",
  "settlementPendingEvent",
  "bountyPosted",
  "bidSubmitted",
  "bountyAwarded",
  "challengeOpened",
]);

function pairKey(x: string, y: string): string {
  return x < y ? `${x}::${y}` : `${y}::${x}`;
}

const MIN_RADIUS = 7;
const MAX_RADIUS = 26;

// A minimal pass-through node for an edge endpoint that ISN'T a registered
// Agent — the common case in practice: most jobs are posted by a plain
// consumer wallet, not another agent, and `buildGraphEdges`/`mergeGraphEdges`
// aggregate by raw pubkey regardless of registration. Without this, any
// relationship whose counterparty isn't a registered Agent could never
// render as a connected edge no matter how much history gets aggregated —
// on this app's actual devnet data, that turned out to be ALL of them,
// which is the real reason the graph looked disconnected (see Task 1's
// "report what the actual cause was if different" — the ~120-event backfill
// window was real but not the dominant cause; this node-registration filter
// was). Zeroed stats are accurate, not a placeholder — a wallet that never
// registered as an Agent has no stake/score to show.
function ghostNode(owner: string): FleetAgent {
  return {
    owner,
    pubkey: owner,
    identity: identityFor(owner),
    capabilities: [],
    stakeAmount: 0,
    scoreCompleted: 0,
    scoreFailed: 0,
    scoreVolume: 0,
    slashEvents: 0,
    lastSlashSlot: 0,
    openJobs: 0,
    createdAt: 0,
  };
}

// Sized by stake + lifetime volume (sqrt-scaled so one whale agent doesn't
// visually swallow the graph) — matches the spec's "sized/styled by stake or
// lifetime volume" instruction. `edges` is optional/defaults to none for
// callers that only care about registered agents (there are none left in
// this codebase, but keeps the signature honest about what changed);
// NetworkGraph.tsx always passes the current edge set so ghost
// counterparties get a node to connect to.
export function buildGraphNodes(agents: FleetAgent[], edges: GraphEdge[] = []): GraphNode[] {
  const byOwner = new Map(agents.map((a) => [a.owner, a]));
  const ghostOwners = new Set<string>();
  for (const e of edges) {
    if (!byOwner.has(e.a)) ghostOwners.add(e.a);
    if (!byOwner.has(e.b)) ghostOwners.add(e.b);
  }
  const allAgents = ghostOwners.size === 0 ? agents : [...agents, ...Array.from(ghostOwners, ghostNode)];

  if (allAgents.length === 0) return [];
  const weights = allAgents.map((a) => Math.sqrt(Math.max(0, a.stakeAmount) + Math.max(0, a.scoreVolume)));
  const max = Math.max(...weights, 1);
  return allAgents.map((agent, i) => ({
    owner: agent.owner,
    agent,
    radius: MIN_RADIUS + (weights[i] / max) * (MAX_RADIUS - MIN_RADIUS),
  }));
}

// Single per-row accumulation step, shared by buildGraphEdges (a full,
// chronological fold from scratch) and mergeGraphEdges (folding only the
// NEW rows on top of an already-built base map) — one place owns "what does
// one more event do to a pair's aggregate," so the two callers can't drift
// out of sync with each other.
function foldRowIntoEdges(map: Map<string, GraphEdge>, row: FeedRow): void {
  const { consumer, provider } = row;
  if (!consumer || !provider || consumer === provider) return;

  const key = pairKey(consumer, provider);
  const family = familyOf(row.state);
  const isDispute = family === "dispute";
  const isSlash = family === "slash";
  const isHire = row.kind === "jobProposed" || row.kind === "bountyAwarded";
  const settledAmount = row.state === "settled" ? (row.amount ?? 0) : 0;
  const hasOpenJob = IN_FLIGHT_KINDS.has(row.kind);

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
    existing.hasOpenJob = hasOpenJob;
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
      hasOpenJob,
    });
  }
}

// `totalVolume` counts only settled amounts (the same "volume" definition
// scoreVolume already uses on-chain) — a proposed-but-never-settled amount
// isn't money that actually moved between the two agents yet.
export function buildGraphEdges(feed: FeedRow[]): GraphEdge[] {
  const map = new Map<string, GraphEdge>();
  // feed is newest-first; walk oldest-first so lastEventTs/lastRowId/
  // hasOpenJob end up holding the true latest event once the loop finishes.
  for (let i = feed.length - 1; i >= 0; i--) foldRowIntoEdges(map, feed[i]);
  return Array.from(map.values());
}

// Task 1 (network graph honesty fix): the client's live feed only ever holds
// a ~120-event backfill window (see events.ts's STREAM_BACKFILL_LIMIT), so
// building edges from `feed` alone silently drops any relationship older
// than that window — nodes come from the full agent snapshot, so those
// older relationships rendered as disconnected dots even though the
// on-chain history clearly connects them. The fix: the server aggregates
// edges from the FULL cached event history (chainCache.ts's getRelationships,
// backed by getEventRows's 150-event cache) and ships that down as `base`;
// this merges only the rows strictly NEWER than the snapshot's cutoff
// (`baseMaxTs`) on top of it, so a live event is counted exactly once
// whether it arrived via the server snapshot or the client's own stream,
// never both.
export function mergeGraphEdges(base: GraphEdge[], liveRows: FeedRow[], baseMaxTs: number): GraphEdge[] {
  const map = new Map<string, GraphEdge>();
  for (const e of base) map.set(e.id, { ...e });
  // liveRows (economy.ts's feed) is newest-first; walk oldest-first so
  // hasOpenJob/lastEventTs end up reflecting the true latest incremental row.
  for (let i = liveRows.length - 1; i >= 0; i--) {
    const row = liveRows[i];
    if (row.ts <= baseMaxTs) continue; // already reflected in `base`
    foldRowIntoEdges(map, row);
  }
  return Array.from(map.values());
}

// Same "count each event exactly once" merge as mergeGraphEdges, but for the
// raw row list itself rather than the aggregated edges — this is what backs
// the network graph's per-node/per-edge activity logs (Task 3), so those
// panels can show the full server-cached history plus whatever's landed
// live since, instead of being limited to the client's own ~120-event feed
// window. Returns newest-first, matching every other feed display in the app.
export function mergeFeedRows(base: FeedRow[], liveRows: FeedRow[], baseMaxTs: number): FeedRow[] {
  const incremental = liveRows.filter((r) => r.ts > baseMaxTs); // already newest-first
  const older = [...base].reverse(); // base is oldest→newest; flip to newest-first
  return [...incremental, ...older];
}
