"use client";

import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import { FeedRowItem } from "./FeedRowItem";
import type { GraphNode, GraphEdge } from "@/lib/graph";
import type { FeedRow, FleetAgent } from "@/lib/economy";

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

function fmt(micro: number): string {
  return (micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Task 3's "click/tap an EDGE -> side panel shows the chronological economic
// log between the two agents." Mirrors NetworkSidePanel's shape (same
// header/close/scroll conventions) but keyed on a PAIR rather than a single
// agent — this is the honest "what happened between them" record: message
// content isn't on-chain, so the economic log (propose/accept/settle/slash,
// with amounts and timestamps) IS the communication record between two agents.
export function NetworkEdgePanel({
  edge,
  a,
  b,
  rows,
  onClose,
}: {
  edge: GraphEdge;
  a: GraphNode | null;
  b: GraphNode | null;
  rows: FeedRow[];
  onClose: () => void;
}) {
  const agentsByOwner = new Map<string, FleetAgent>();
  if (a) agentsByOwner.set(a.owner, a.agent);
  if (b) agentsByOwner.set(b.owner, b.agent);

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[300px] flex-col border-l border-ink-line bg-ink-raised shadow-2xl">
      <div className="flex items-center justify-between border-b border-ink-line px-3 py-2">
        <h3 className="text-[10px] tracking-[0.2em] text-ink-faint">RELATIONSHIP</h3>
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
        <div className="flex items-center gap-2">
          {[a, b].map((n, i) =>
            n ? (
              <Link
                key={n.owner}
                href={`/agent/${n.owner}`}
                className="flex min-w-0 flex-1 items-center gap-1.5 border border-ink-line px-2 py-1.5 hover:bg-bone/[0.05]"
              >
                <AgentAvatar identity={n.agent.identity} size={20} />
                <span className="truncate text-[11px] font-semibold text-bone">{n.agent.identity.name}</span>
              </Link>
            ) : (
              <span key={i} className="flex-1 border border-ink-line px-2 py-1.5 text-[10px] text-ink-faint">
                unknown
              </span>
            )
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <MiniStat label="HIRED" value={`${edge.hireCount}×`} />
          <MiniStat label="VOLUME" value={`$${fmt(edge.totalVolume)}`} accent />
          <MiniStat label="SLASHES" value={String(edge.slashes)} danger={edge.slashes > 0} />
        </div>

        <div className="mt-3 flex items-center gap-2 text-[9px] tracking-[0.14em]">
          <span className={FAMILY_TEXT[edge.dominantFamily]}>{FAMILY_LABEL[edge.dominantFamily]}</span>
          {edge.hasOpenJob && <span className="text-amber-ink">· JOB IN FLIGHT</span>}
          {edge.disputes > 0 && <span className="text-ink-faint">· {edge.disputes} DISPUTE{edge.disputes === 1 ? "" : "S"}</span>}
        </div>

        <div className="mt-4 border-t border-ink-line pt-3">
          <h4 className="text-[9px] tracking-[0.18em] text-ink-faint">
            ECONOMIC LOG · {rows.length}
          </h4>
          <div className="mt-2 -mx-3 flex flex-col">
            {rows.length === 0 && (
              <p className="px-3 text-[10px] text-ink-faint">no recorded activity between these two yet</p>
            )}
            {rows.map((row) => (
              <FeedRowItem key={row.id} row={row} agents={agentsByOwner} />
            ))}
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
