"use client";

import { useMemo, useState } from "react";
import { Panel } from "./Panel";
import { AgentCard } from "./AgentCard";
import { DeployModal } from "./DeployModal";
import { computeStreaks } from "@/lib/streaks";
import { deriveReputationBadges, deriveVanityBadges, type ReputationBadge, type VanityBadge } from "@/lib/badges";
import { buildReputationInput, buildVanityInput, computeRegistrationRanks } from "@/lib/badgeInputs";
import type { FleetAgent, FeedRow } from "@/lib/economy";

export function FleetPanel({ agents, feed }: { agents: FleetAgent[]; feed: FeedRow[] }) {
  const [deployOpen, setDeployOpen] = useState(false);
  const streaks = useMemo(() => computeStreaks(feed), [feed]);

  const badgesByOwner = useMemo(() => {
    const ranks = computeRegistrationRanks(agents.map((a) => ({ owner: a.owner, createdAt: a.createdAt })));
    const map = new Map<string, { reputation: ReputationBadge[]; vanity: VanityBadge[] }>();
    for (const a of agents) {
      map.set(a.owner, {
        reputation: deriveReputationBadges(buildReputationInput(a, feed)),
        vanity: deriveVanityBadges(buildVanityInput(a.owner, feed, ranks.get(a.owner) ?? 0)),
      });
    }
    return map;
  }, [agents, feed]);

  const sorted = [...agents].sort((a, b) => {
    if (a.openJobs !== b.openJobs) return b.openJobs - a.openJobs;
    return b.scoreVolume - a.scoreVolume;
  });

  // Rank is by volume (matching the leaderboard's default mode) — independent
  // of the display order above, which prioritizes active agents instead so
  // "who's working right now" surfaces first.
  const rankByOwner = useMemo(() => {
    const byVolume = [...agents].sort((a, b) => b.scoreVolume - a.scoreVolume);
    return new Map(byVolume.map((a, i) => [a.owner, i + 1]));
  }, [agents]);

  return (
    <>
      <Panel
        title={`FLEET · ${agents.length}`}
        className="xl:h-full"
        bodyClassName="flex flex-col xl:overflow-hidden"
        right={
          <button
            type="button"
            onClick={() => setDeployOpen(true)}
            className="border border-bone bg-bone px-2 py-1 text-[9px] tracking-[0.14em] text-ink hover:opacity-80"
          >
            + DEPLOY AGENT
          </button>
        }
      >
        <div className="xl:flex-1 xl:overflow-y-auto">
          {sorted.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-ink-faint">
              no agents registered yet
            </div>
          )}
          {sorted.map((a) => (
            <AgentCard
              key={a.owner}
              agent={a}
              rank={rankByOwner.get(a.owner) ?? sorted.length}
              streak={streaks.get(a.owner) ?? 0}
              badges={badgesByOwner.get(a.owner) ?? { reputation: [], vanity: [] }}
            />
          ))}
        </div>
      </Panel>
      {deployOpen && <DeployModal onClose={() => setDeployOpen(false)} />}
    </>
  );
}
