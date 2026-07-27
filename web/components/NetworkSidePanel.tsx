"use client";

import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import type { GraphNode, GraphEdge } from "@/lib/graph";

function fmt(micro: number): string {
  return (micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const FAMILY_LABEL: Record<GraphEdge["dominantFamily"], string> = {
  pending: "IN-FLIGHT",
  settled: "SETTLED",
  dispute: "DISPUTE",
  slash: "SLASHED",
};

const FAMILY_TEXT: Record<GraphEdge["dominantFamily"], string> = {
  pending: "text-ink-faint",
  settled: "text-green-ink",
  dispute: "text-warn-ink",
  slash: "text-danger-ink",
};

// Click-through detail panel for a selected node (Task 1's "click -> side
// panel with the agent's record ... and a link through to /agent/[pubkey]").
export function NetworkSidePanel({
  node,
  edges,
  allNodes,
  onClose,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  onClose: () => void;
}) {
  const { agent } = node;
  const total = agent.scoreCompleted + agent.scoreFailed;
  const clean = total === 0 ? 100 : Math.round((agent.scoreCompleted / total) * 100);
  const byOwner = new Map(allNodes.map((n) => [n.owner, n]));

  const sortedEdges = [...edges].sort((a, b) => b.totalVolume - a.totalVolume);

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[300px] flex-col border-l border-ink-line bg-ink-raised shadow-2xl">
      <div className="flex items-center justify-between border-b border-ink-line px-3 py-2">
        <h3 className="text-[10px] tracking-[0.2em] text-ink-faint">AGENT RECORD</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-ink-faint hover:text-bone"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center gap-3">
          <AgentAvatar identity={agent.identity} size={40} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-bone">{agent.identity.name}</div>
            <div className="truncate text-[9px] text-ink-faint">{agent.owner}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <MiniStat label="EARNED" value={`$${fmt(agent.scoreVolume)}`} accent />
          <MiniStat label="JOBS DONE" value={String(agent.scoreCompleted)} />
          <MiniStat label="CLEAN" value={`${clean}%`} danger={agent.slashEvents > 0} />
          <MiniStat label="SLASHES" value={String(agent.slashEvents)} danger={agent.slashEvents > 0} />
        </div>

        <div className="mt-3 text-[9px] tracking-[0.14em] text-ink-faint">
          {agent.openJobs > 0 ? `ACTIVE · ${agent.openJobs} OPEN JOB${agent.openJobs === 1 ? "" : "S"}` : "IDLE"}
          {" · "}STAKE ${fmt(agent.stakeAmount)}
        </div>

        {agent.capabilities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.capabilities.map((c) => (
              <span key={c} className="border border-ink-line px-1.5 py-0.5 text-[9px] text-ink-dim">
                {c}
              </span>
            ))}
          </div>
        )}

        <Link
          href={`/agent/${agent.owner}`}
          className="mt-3 block border border-bone bg-bone px-3 py-1.5 text-center text-[10px] tracking-[0.14em] text-ink hover:opacity-80"
        >
          VIEW FULL PROFILE →
        </Link>

        <div className="mt-4 border-t border-ink-line pt-3">
          <h4 className="text-[9px] tracking-[0.18em] text-ink-faint">
            ECONOMIC CONNECTIONS · {sortedEdges.length}
          </h4>
          <div className="mt-2 flex flex-col gap-1.5">
            {sortedEdges.length === 0 && (
              <p className="text-[10px] text-ink-faint">no recorded activity with other agents yet</p>
            )}
            {sortedEdges.map((e) => {
              const otherOwner = e.a === node.owner ? e.b : e.a;
              const other = byOwner.get(otherOwner);
              return (
                <Link
                  key={e.id}
                  href={`/agent/${otherOwner}`}
                  className="flex items-center justify-between gap-2 border border-ink-line px-2 py-1.5 hover:bg-bone/[0.05]"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    {other && <AgentAvatar identity={other.agent.identity} size={18} />}
                    <span className="truncate text-[10px] text-bone">
                      {other?.agent.identity.name ?? otherOwner.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[9px]">
                    <span className="tabular-nums text-ink-faint">{e.hireCount}× hired</span>
                    <span className={"tracking-[0.1em] " + FAMILY_TEXT[e.dominantFamily]}>
                      {FAMILY_LABEL[e.dominantFamily]}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="border border-ink-line bg-ink px-2 py-1.5">
      <div
        className={
          "text-[12px] font-semibold tabular-nums " +
          (danger ? "text-danger-ink" : accent ? "text-amber-ink" : "text-bone")
        }
      >
        {value}
      </div>
      <div className="text-[8px] tracking-[0.12em] text-ink-faint">{label}</div>
    </div>
  );
}
