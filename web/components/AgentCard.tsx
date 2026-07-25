"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import type { FleetAgent } from "@/lib/economy";

function fmt(micro: number): string {
  return (micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AgentCard({ agent }: { agent: FleetAgent }) {
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
        "block border-b border-ink-line px-3 py-2.5 transition-colors duration-500 hover:bg-ink/60" +
        (flash === "slash" ? " animate-slash-shake bg-danger-dim/40" : "") +
        (flash === "settle" ? " bg-amber-dim/15" : "")
      }
    >
      <div className="flex items-center gap-2.5">
        <AgentAvatar identity={agent.identity} size={30} flash={flash} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[12px] text-bone">{agent.identity.name}</span>
            <span
              className={
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] tracking-[0.12em] " +
                (active ? "border-amber-dim text-amber" : "border-ink-line text-bone-faint")
              }
            >
              {active ? `ACTIVE·${agent.openJobs}` : "IDLE"}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-bone-faint">
            {agent.capabilities.length > 0 ? agent.capabilities.join(", ") : "no capabilities listed"}
          </div>
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
      <div className="mt-1.5 text-[9px] text-bone-faint">
        stake ${fmt(agent.stakeAmount)} · {agent.owner.slice(0, 4)}…{agent.owner.slice(-4)}
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
    <div className="rounded-sm bg-ink px-1 py-1">
      <div
        className={
          "text-[11px] font-semibold tabular-nums " +
          (danger ? "text-danger" : warn ? "text-warn" : accent ? "text-amber" : "text-bone")
        }
      >
        {value}
      </div>
      <div className="text-[8px] tracking-[0.14em] text-bone-faint">{label}</div>
    </div>
  );
}
