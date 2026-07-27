"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import { ReputationBadgeRow, VanityBadgeRow } from "./BadgeRow";
import type { FleetAgent } from "@/lib/economy";
import type { ReputationBadge, VanityBadge } from "@/lib/badges";

function fmt(micro: number): string {
  return (micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Each card is meant to be a status object an owner would screenshot: rank,
// record, earnings, stake, all legible at a glance — and unmistakably a
// link to the full profile (Task 2).
export function AgentCard({
  agent,
  rank,
  streak,
  badges,
}: {
  agent: FleetAgent;
  rank: number;
  streak: number;
  badges: { reputation: ReputationBadge[]; vanity: VanityBadge[] };
}) {
  const [flash, setFlash] = useState<"slash" | "settle" | null>(null);
  const [prevSlashed, setPrevSlashed] = useState(agent.justSlashed);
  const [prevSettled, setPrevSettled] = useState(agent.justSettled);

  // Adjust state during render on prop change (react.dev/learn/you-might-not-need-an-effect)
  // rather than an effect, so only the timed clear below touches an external timer.
  if (agent.justSlashed !== prevSlashed) {
    setPrevSlashed(agent.justSlashed);
    if (agent.justSlashed) setFlash("slash");
  } else if (agent.justSettled !== prevSettled) {
    setPrevSettled(agent.justSettled);
    if (agent.justSettled && flash !== "slash") setFlash("settle");
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash === "slash" ? 1600 : 900);
    return () => clearTimeout(t);
  }, [flash]);

  const total = agent.scoreCompleted + agent.scoreFailed;
  const reputation = total > 0 ? Math.round((agent.scoreCompleted / total) * 100) : 100;
  const active = agent.openJobs > 0;

  return (
    <Link
      href={`/agent/${agent.owner}`}
      className={
        "group block border-b border-ink-line px-3 py-2.5 transition-colors duration-500 hover:bg-bone/[0.05]" +
        (flash === "slash" ? " animate-slash-shake bg-danger-wash" : "") +
        (flash === "settle" ? " bg-green-wash" : "")
      }
    >
      <div className="flex items-center gap-2.5">
        <AgentAvatar identity={agent.identity} size={30} flash={flash} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-[12px] text-bone group-hover:underline">{agent.identity.name}</span>
              <span className="shrink-0 text-[10px] font-semibold tabular-nums text-ink-faint">#{rank}</span>
            </div>
            <span
              className={
                "shrink-0 border px-1.5 py-0.5 text-[9px] tracking-[0.12em] " +
                (active ? "border-amber bg-amber text-ink" : "border-ink-line text-ink-faint")
              }
            >
              {active ? `ACTIVE·${agent.openJobs}` : "IDLE"}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-ink-faint">
            {agent.capabilities.length > 0 ? agent.capabilities.join(", ") : "no capabilities listed"}
          </div>
          {(badges.reputation.length > 0 || badges.vanity.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-1">
              <ReputationBadgeRow badges={badges.reputation} />
              <VanityBadgeRow badges={badges.vanity} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-1.5 text-center">
        <Stat label="EARNED" value={`$${fmt(agent.scoreVolume)}`} accent />
        <Stat label="JOBS" value={String(agent.scoreCompleted)} />
        <Stat label="REP" value={`${reputation}%`} warn={reputation < 80} />
        <Stat
          label="SLASH"
          value={String(agent.slashEvents)}
          danger={agent.slashEvents > 0}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[9px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span>
            stake ${fmt(agent.stakeAmount)} · {agent.owner.slice(0, 4)}…{agent.owner.slice(-4)}
          </span>
          {streak > 0 && (
            <span
              className={
                "shrink-0 tracking-[0.08em] transition-opacity duration-500 " +
                (flash === "slash" ? "text-danger-ink line-through opacity-70" : streak >= 3 ? "text-amber-ink" : "text-ink-dim")
              }
              title="Consecutive clean settles since the last slash"
            >
              STREAK·{flash === "slash" ? 0 : streak}
            </span>
          )}
        </span>
        <span className="shrink-0 text-ink-faint group-hover:text-bone">PROFILE ›</span>
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  accent,
  warn,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="border border-ink-line bg-ink px-1 py-1">
      <div
        className={
          "text-[11px] font-semibold tabular-nums " +
          (danger ? "text-danger-ink" : warn ? "text-warn-ink" : accent ? "text-amber-ink" : "text-bone")
        }
      >
        {value}
      </div>
      <div className="text-[8px] tracking-[0.14em] text-ink-faint">{label}</div>
    </div>
  );
}
