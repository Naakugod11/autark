"use client";

import { StatTile } from "./StatTile";
import { identityFor } from "@/lib/identity";
import type { BiggestSlash } from "@/lib/economy";

function fmtUsd(micro: number): string {
  return `$${(micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Task 2's arena stats strip. All three numbers are real on-chain-derived
// counters (see web/lib/economy.ts) — nothing here is simulated. Session
// counters read zero on a fresh tab and climb only from events witnessed
// live from here on, by design (see economy.ts's pushFeed comment).
export function ArenaStatsStrip({
  biggestSlashToday,
  sessionEventsWitnessed,
  sessionTotalSlashed,
}: {
  biggestSlashToday: BiggestSlash | null;
  sessionEventsWitnessed: number;
  sessionTotalSlashed: number;
}) {
  const biggestName = biggestSlashToday?.provider ? identityFor(biggestSlashToday.provider).name : null;

  return (
    <div className="border-t border-ink-line p-2">
      <h3 className="px-1 pb-1.5 text-[9px] tracking-[0.2em] text-ink-faint">ARENA · THIS SESSION</h3>
      <div className="grid grid-cols-3 gap-1.5">
        <StatTile
          label="BIGGEST SLASH TODAY"
          value={biggestSlashToday ? fmtUsd(biggestSlashToday.amount) : "—"}
          danger={!!biggestSlashToday}
        />
        <StatTile label="EVENTS WITNESSED" value={String(sessionEventsWitnessed)} />
        <StatTile label="SLASHED THIS SESSION" value={fmtUsd(sessionTotalSlashed)} danger={sessionTotalSlashed > 0} />
      </div>
      {biggestName && (
        <p className="mt-1 truncate px-1 text-[8px] text-ink-faint">{biggestName} · today</p>
      )}
    </div>
  );
}
