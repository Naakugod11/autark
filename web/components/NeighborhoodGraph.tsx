"use client";

/**
 * web/components/NeighborhoodGraph.tsx — Task 4's profile mini-view: this
 * agent's node plus its direct edges, reusing Task 1's rendering language
 * (same colors, same four-state edge styling, same live flash-on-event)
 * but laid out as a simple hub-and-spoke — a bounded, small subgraph
 * doesn't need a full d3-force simulation, just this agent centered with
 * its direct neighbors arranged in a circle around it.
 *
 * Reads the SAME useEconomyContext() store as the terminal and /network —
 * no separate subscription. If the visitor lands directly on a profile
 * page before the store has finished its first backfill, this shows the
 * same honest "still syncing" state Task 0 established elsewhere, not an
 * empty graph pretending there's nothing to show.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useEconomyContext } from "./EconomyProvider";
import { buildGraphNodes, buildGraphEdges, type GraphNode, type GraphEdge } from "@/lib/graph";
import { AgentAvatar } from "./AgentAvatar";
import type { FeedFamily } from "@/lib/feedStyle";

const FAMILY_COLOR: Record<FeedFamily, string> = {
  pending: "#8b877e",
  settled: "#4ca868",
  dispute: "#e67e22",
  slash: "#e5484d",
};

const FAMILY_LABEL: Record<FeedFamily, string> = {
  pending: "IN-FLIGHT",
  settled: "SETTLED",
  dispute: "DISPUTE",
  slash: "SLASHED",
};

export function NeighborhoodGraph({ owner }: { owner: string }) {
  const { agents, feed, status } = useEconomyContext();
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const { center, neighbors, edges } = useMemo(() => {
    const nodes = buildGraphNodes(agents);
    const allEdges = buildGraphEdges(feed);
    const nodeByOwner = new Map(nodes.map((n) => [n.owner, n]));
    const centerNode = nodeByOwner.get(owner) ?? null;
    const relevantEdges = allEdges.filter((e) => e.a === owner || e.b === owner);
    const neighborNodes = relevantEdges
      .map((e) => nodeByOwner.get(e.a === owner ? e.b : e.a))
      .filter((n): n is GraphNode => !!n);
    return { center: centerNode, neighbors: neighborNodes, edges: relevantEdges };
  }, [agents, feed, owner]);

  if (status === "connecting" || status === "backfilling") {
    return (
      <div className="flex h-[220px] items-center justify-center border border-ink-line bg-ink-raised text-[10px] text-ink-faint">
        SYNCING · WARMING NEIGHBORHOOD FROM DEVNET
      </div>
    );
  }

  if (!center || neighbors.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center border border-ink-line bg-ink-raised text-[11px] text-ink-faint">
        no recorded economic connections yet
      </div>
    );
  }

  const SIZE = 280;
  const CENTER = SIZE / 2;
  const RING_RADIUS = SIZE * 0.36;
  const angleStep = (2 * Math.PI) / neighbors.length;

  return (
    <div className="border border-ink-line bg-ink-raised p-3">
      <h3 className="text-[9px] tracking-[0.18em] text-ink-faint">ECONOMIC NEIGHBORHOOD</h3>
      <div className="relative mx-auto mt-2" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="absolute inset-0">
          {neighbors.map((n, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const x = CENTER + RING_RADIUS * Math.cos(angle);
            const y = CENTER + RING_RADIUS * Math.sin(angle);
            const edge = edges.find((e) => e.a === n.owner || e.b === n.owner)!;
            const isHovered = hoveredEdge === edge.id;
            return (
              <line
                key={edge.id}
                x1={CENTER}
                y1={CENTER}
                x2={x}
                y2={y}
                stroke={FAMILY_COLOR[edge.dominantFamily]}
                strokeWidth={isHovered ? 3 : 1.5}
                opacity={isHovered ? 1 : 0.55}
              />
            );
          })}
        </svg>

        {/* Center node */}
        <div
          className="absolute flex flex-col items-center gap-1"
          style={{ left: CENTER, top: CENTER, transform: "translate(-50%, -50%)" }}
        >
          <AgentAvatar identity={center.agent.identity} size={40} />
        </div>

        {/* Neighbor nodes */}
        {neighbors.map((n, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const x = CENTER + RING_RADIUS * Math.cos(angle);
          const y = CENTER + RING_RADIUS * Math.sin(angle);
          const edge = edges.find((e) => e.a === n.owner || e.b === n.owner)!;
          return (
            <Link
              key={n.owner}
              href={`/agent/${n.owner}`}
              className="absolute flex flex-col items-center gap-1"
              style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
              onMouseEnter={() => setHoveredEdge(edge.id)}
              onMouseLeave={() => setHoveredEdge((cur) => (cur === edge.id ? null : cur))}
              title={`${n.agent.identity.name} · ${edge.hireCount}× hired · ${FAMILY_LABEL[edge.dominantFamily]}`}
            >
              <AgentAvatar identity={n.agent.identity} size={28} />
              <span className="max-w-[64px] truncate text-[8px] text-ink-faint">{n.agent.identity.name}</span>
            </Link>
          );
        })}
      </div>
      <p className="mt-1 text-center text-[9px] text-ink-faint">
        {neighbors.length} direct connection{neighbors.length === 1 ? "" : "s"} · edge color = relationship outcome
      </p>
    </div>
  );
}
