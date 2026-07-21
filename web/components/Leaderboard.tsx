"use client";

import { useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import type { FleetAgent } from "@/lib/economy";

type SortMode = "volume" | "clean";

function cleanScore(a: FleetAgent): number {
  const total = a.scoreCompleted + a.scoreFailed;
  if (total === 0) return 1;
  return a.scoreCompleted / total;
}

export function Leaderboard({ agents }: { agents: FleetAgent[] }) {
  const [mode, setMode] = useState<SortMode>("volume");

  const ranked = [...agents]
    .sort((a, b) =>
      mode === "volume"
        ? b.scoreVolume - a.scoreVolume
        : cleanScore(b) - cleanScore(a) || b.scoreVolume - a.scoreVolume
    )
    .slice(0, 8);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-[10px] tracking-[0.2em] text-bone-faint">TOP EARNERS</h3>
        <div className="flex gap-1">
          {(["volume", "clean"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={
                "rounded-sm border px-1.5 py-0.5 text-[9px] tracking-[0.1em] " +
                (mode === m
                  ? "border-amber-dim text-amber"
                  : "border-ink-line text-bone-faint hover:text-bone-dim")
              }
            >
              {m === "volume" ? "VOLUME" : "CLEAN"}
            </button>
          ))}
        </div>
      </div>
      <div>
        {ranked.length === 0 && (
          <div className="px-3 pb-3 text-[11px] text-bone-faint">no agents yet</div>
        )}
        {ranked.map((a, i) => (
          <div
            key={a.owner}
            className="flex items-center gap-2 border-t border-ink-line px-3 py-1.5"
          >
            <span className="w-4 shrink-0 text-[10px] tabular-nums text-bone-faint">{i + 1}</span>
            <AgentAvatar identity={a.identity} size={20} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-bone">{a.identity.name}</span>
            {mode === "volume" ? (
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-amber">
                ${(a.scoreVolume / 1e6).toFixed(2)}
              </span>
            ) : (
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-bone">
                {Math.round(cleanScore(a) * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
