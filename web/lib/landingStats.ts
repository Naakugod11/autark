/**
 * web/lib/landingStats.ts — landing-page stats, derived from the shared
 * chain caches (web/lib/chainCache.ts). No RPC call lives in this file: the
 * same getAgentsSnapshot()/getEventRows() calls back agent profiles too, so
 * a landing hit and a profile hit inside the same revalidate window share
 * both caches rather than each paying for their own chain read.
 */

import { getAgentsSnapshot, getEventRows } from "./chainCache";
import { identityFor } from "./identity";

export type FeaturedAgent = {
  owner: string;
  name: string;
  rankOfVolume: number;
  totalAgents: number;
  scoreVolume: number;
  scoreCompleted: number;
  slashEvents: number;
};

export type LandingStats = {
  activeAgents: number;
  totalAgents: number;
  volume24h: number; // micro-USDC
  totalSlashed: number; // micro-USDC
  lastEventAt: number | null; // ms epoch
  featuredAgent: FeaturedAgent | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getLandingStats(): Promise<LandingStats> {
  const [{ agents, pool }, { rows }] = await Promise.all([getAgentsSnapshot(), getEventRows()]);

  const now = Date.now();
  let volume24h = 0;
  let lastEventAt: number | null = null;

  for (const row of rows) {
    if (row.ts > 0 && (lastEventAt == null || row.ts > lastEventAt)) lastEventAt = row.ts;
    if (row.state === "settled" && row.amount != null && now - row.ts <= DAY_MS) {
      volume24h += row.amount;
    }
  }

  const byVolume = [...agents].sort((a, b) => b.scoreVolume - a.scoreVolume);
  // Prefer showcasing a genuinely clean agent (the "ego pitch" is about
  // reputation, not just raw activity) — fall back to the top earner if
  // nothing clean has meaningful volume yet.
  const featured =
    byVolume.find((a) => a.slashEvents === 0 && a.scoreVolume > 0) ?? byVolume[0] ?? null;

  const featuredAgent: FeaturedAgent | null = featured
    ? {
        owner: featured.owner,
        name: identityFor(featured.owner).name,
        rankOfVolume: byVolume.findIndex((a) => a.owner === featured.owner) + 1,
        totalAgents: agents.length,
        scoreVolume: featured.scoreVolume,
        scoreCompleted: featured.scoreCompleted,
        slashEvents: featured.slashEvents,
      }
    : null;

  return {
    activeAgents: agents.filter((a) => a.openJobs > 0).length,
    totalAgents: agents.length,
    volume24h,
    totalSlashed: pool?.totalSlashed ?? 0,
    lastEventAt,
    featuredAgent,
  };
}
