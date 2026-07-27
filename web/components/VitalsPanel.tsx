"use client";

import { useEffect, useRef, useState } from "react";
import { Panel } from "./Panel";
import { StatTile } from "./StatTile";
import { Leaderboard } from "./Leaderboard";
import { ArenaStatsStrip } from "./ArenaStatsStrip";
import type { BiggestSlash, FleetAgent, FeedRow } from "@/lib/economy";

function fmtUsd(micro: number): string {
  return `$${(micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function VitalsPanel({
  agents,
  feed,
  totalSlashed,
  volume24h,
  eventsLast5Min,
  biggestSlashToday,
  sessionEventsWitnessed,
  sessionTotalSlashed,
}: {
  agents: FleetAgent[];
  feed: FeedRow[];
  totalSlashed: number;
  volume24h: number;
  eventsLast5Min: number;
  biggestSlashToday: BiggestSlash | null;
  sessionEventsWitnessed: number;
  sessionTotalSlashed: number;
}) {
  const [slashFlash, setSlashFlash] = useState(false);
  const prevSlashed = useRef(totalSlashed);

  useEffect(() => {
    if (totalSlashed > prevSlashed.current) {
      setSlashFlash(true);
      const t = setTimeout(() => setSlashFlash(false), 1400);
      prevSlashed.current = totalSlashed;
      return () => clearTimeout(t);
    }
    prevSlashed.current = totalSlashed;
  }, [totalSlashed]);

  const activeAgents = agents.filter((a) => a.openJobs > 0).length;

  return (
    <Panel title="NETWORK VITALS" className="xl:h-full" bodyClassName="flex flex-col xl:overflow-hidden">
      <div className="grid grid-cols-2 gap-1.5 p-2">
        <StatTile label="ACTIVE AGENTS" value={String(activeAgents)} />
        <StatTile label="EVENTS / 5M" value={String(eventsLast5Min)} />
        <StatTile label="24H VOLUME" value={fmtUsd(volume24h)} accent />
        <StatTile
          label="TOTAL SLASHED"
          value={fmtUsd(totalSlashed)}
          danger
          flash={slashFlash}
        />
      </div>
      <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto border-t border-ink-line">
        <Leaderboard agents={agents} feed={feed} />
        <ArenaStatsStrip
          biggestSlashToday={biggestSlashToday}
          sessionEventsWitnessed={sessionEventsWitnessed}
          sessionTotalSlashed={sessionTotalSlashed}
        />
      </div>
    </Panel>
  );
}
