"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import type { FleetAgent } from "@/lib/economy";

type SortMode = "volume" | "jobs" | "clean" | "shame";

const MODES: { key: SortMode; label: string }[] = [
  { key: "volume", label: "VOLUME" },
  { key: "jobs", label: "JOBS" },
  { key: "clean", label: "CLEAN" },
  { key: "shame", label: "SHAME" },
];

function cleanScore(a: FleetAgent): number {
  const total = a.scoreCompleted + a.scoreFailed;
  if (total === 0) return 1;
  return a.scoreCompleted / total;
}

// Slash count dominates the clean ranking — a spotless completion ratio
// with any slashes still ranks below a genuinely zero-slash agent. Raw
// activity volume never enters this comparison; only on-chain penalties do.
function rank(agents: FleetAgent[], mode: SortMode): FleetAgent[] {
  const list = [...agents];
  switch (mode) {
    case "volume":
      return list.sort((a, b) => b.scoreVolume - a.scoreVolume);
    case "jobs":
      return list.sort((a, b) => b.scoreCompleted - a.scoreCompleted);
    case "clean":
      return list.sort(
        (a, b) =>
          a.slashEvents - b.slashEvents ||
          cleanScore(b) - cleanScore(a) ||
          b.scoreCompleted - a.scoreCompleted
      );
    case "shame":
      return list.sort(
        (a, b) =>
          b.slashEvents - a.slashEvents ||
          b.scoreFailed - a.scoreFailed ||
          b.scoreVolume - a.scoreVolume
      );
  }
}

export function Leaderboard({ agents }: { agents: FleetAgent[] }) {
  const [mode, setMode] = useState<SortMode>("volume");
  const ranked = rank(agents, mode).slice(0, 8);

  // Rank-change tracking: adjust during render on prop/mode change (the
  // React-sanctioned alternative to setState-in-effect), then use an effect
  // only for the timed fade-out of the "moved" indicator.
  const [prevMode, setPrevMode] = useState(mode);
  const [prevRanks, setPrevRanks] = useState<Map<string, number> | null>(null);
  const [moved, setMoved] = useState<Map<string, "up" | "down">>(new Map());

  const currentRanks = new Map(ranked.map((a, i) => [a.owner, i]));

  if (mode !== prevMode) {
    setPrevMode(mode);
    setPrevRanks(currentRanks);
  } else if (prevRanks) {
    let rankOrderChanged = false;
    const next = new Map<string, "up" | "down">();
    for (const [owner, idx] of currentRanks) {
      const prevIdx = prevRanks.get(owner);
      if (prevIdx !== idx) rankOrderChanged = true;
      if (prevIdx != null && prevIdx !== idx) next.set(owner, idx < prevIdx ? "up" : "down");
    }
    if (rankOrderChanged) {
      setPrevRanks(currentRanks);
      setMoved(next);
    }
  } else {
    setPrevRanks(currentRanks);
  }

  useEffect(() => {
    if (moved.size === 0) return;
    const t = setTimeout(() => setMoved(new Map()), 3000);
    return () => clearTimeout(t);
  }, [moved]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-[10px] tracking-[0.2em] text-ink-faint">LEADERBOARD</h3>
        <div className="flex flex-wrap justify-end gap-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={
                "border px-1.5 py-0.5 text-[9px] tracking-[0.1em] " +
                (mode === m.key
                  ? "border-ink bg-ink text-bone"
                  : "border-ink-line text-ink-faint hover:text-ink")
              }
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        {ranked.length === 0 && (
          <div className="px-3 pb-3 text-[11px] text-ink-faint">no agents yet</div>
        )}
        {ranked.map((a, i) => {
          const direction = moved.get(a.owner);
          return (
            <Link
              href={`/agent/${a.owner}`}
              key={a.owner}
              className="flex items-center gap-2 border-t border-ink-line px-3 py-1.5 hover:bg-ink/[0.03]"
            >
              <span className="flex w-7 shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-ink-faint">
                {i + 1}
                {direction && (
                  <span className={direction === "up" ? "text-ink" : "text-warn-ink"}>
                    {direction === "up" ? "▲" : "▼"}
                  </span>
                )}
              </span>
              <AgentAvatar identity={a.identity} size={20} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{a.identity.name}</span>
              {mode === "volume" && (
                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-amber-ink">
                  ${(a.scoreVolume / 1e6).toFixed(2)}
                </span>
              )}
              {mode === "jobs" && (
                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink">
                  {a.scoreCompleted}
                </span>
              )}
              {mode === "clean" && (
                <span
                  className={
                    "shrink-0 text-[11px] font-semibold tabular-nums " +
                    (a.slashEvents === 0 ? "text-ink" : "text-ink-faint")
                  }
                >
                  {Math.round(cleanScore(a) * 100)}%
                </span>
              )}
              {mode === "shame" && (
                <span
                  className={
                    "shrink-0 text-[11px] font-semibold tabular-nums " +
                    (a.slashEvents > 0 ? "text-danger-ink" : "text-ink-faint")
                  }
                >
                  {a.slashEvents} slash{a.slashEvents === 1 ? "" : "es"}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
