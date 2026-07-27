"use client";

/**
 * web/components/NetworkGraph.tsx — Task 1's live agent economic-interaction
 * graph. Canvas + d3-force, fed by the SAME useEconomyContext() store the
 * terminal reads (web/lib/economy.ts) — no separate subscription, no
 * separate fetch. web/lib/graph.ts turns that store's agents[]/feed[] into
 * nodes/edges on every render; this component owns the physics simulation
 * and the canvas draw loop only.
 *
 * Node = a registered agent, sized by stake+volume. Edge = an aggregated
 * consumer<->provider relationship, colored by the same four-state family
 * system as the feed (settled/pending/dispute/slash), sticky toward the
 * worst outcome ever seen on that edge. This is the honest "who's
 * economically connected to whom" picture — message content isn't
 * on-chain, so there is nothing else to draw.
 *
 * Simulation settles (alpha decays to ~0) and idles — no redraw loop running
 * while nothing is moving. A live event briefly reheats it (small alpha
 * bump) so new nodes/edges visibly settle into place instead of teleporting.
 * Paused entirely on tab-hidden via the Page Visibility API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { useEconomyContext } from "./EconomyProvider";
import { buildGraphNodes, buildGraphEdges, type GraphNode, type GraphEdge } from "@/lib/graph";
import { NetworkSidePanel } from "./NetworkSidePanel";
import type { FeedFamily } from "@/lib/feedStyle";

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { edge: GraphEdge };

// Raw values matching web/app/globals.css's tokens — canvas fillStyle/
// strokeStyle needs literal color strings, not Tailwind classes or a
// per-frame getComputedStyle() call. Keep these in sync if the palette in
// globals.css ever changes.
const C = {
  inkRaised: "#26231d",
  inkLine: "#4b4740",
  inkFaint: "#8b877e",
  bone: "#ece6da",
  amber: "#e0a100",
  danger: "#e5484d",
  green: "#4ca868",
  warn: "#e67e22",
};

const FAMILY_COLOR: Record<FeedFamily, string> = {
  pending: C.inkFaint,
  settled: C.green,
  dispute: C.warn,
  slash: C.danger,
};

const FAMILY_WIDTH: Record<FeedFamily, number> = {
  pending: 1,
  settled: 1.5,
  dispute: 2,
  slash: 3,
};

type Flash = { edgeId: string; owners: [string, string]; kind: "settle" | "slash"; startedAt: number };

const FLASH_MS = 1500;

export function NetworkGraph() {
  const { agents, feed, status } = useEconomyContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const flashRef = useRef<Flash | null>(null);
  const lastRowIdRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 800, h: 520 });
  const hiddenRef = useRef(false);

  const [size, setSize] = useState({ w: 800, h: 520 });
  const [hover, setHover] = useState<{ owner: string; clientX: number; clientY: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes: graphNodes, edges: graphEdges } = useMemo(
    () => ({ nodes: buildGraphNodes(agents), edges: buildGraphEdges(feed) }),
    [agents, feed]
  );

  // ── Responsive canvas sizing ──────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const next = { w: Math.max(280, width), h: Math.max(280, height) };
      sizeRef.current = next;
      setSize(next);
      simRef.current?.force("center", forceCenter(next.w / 2, next.h / 2));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Draw ───────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const { w, h } = sizeRef.current;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const flash = flashRef.current;
    const flashActive = flash && Date.now() - flash.startedAt < FLASH_MS;
    if (flash && !flashActive) flashRef.current = null;

    // Edges first, under the nodes.
    for (const link of linksRef.current) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
      const isFlashing = flashActive && flash!.edgeId === link.edge.id;
      const color = isFlashing ? (flash!.kind === "slash" ? C.danger : C.green) : FAMILY_COLOR[link.edge.dominantFamily];
      const baseWidth = FAMILY_WIDTH[link.edge.dominantFamily];
      const pulse = isFlashing ? 1 + 2 * (1 - (Date.now() - flash!.startedAt) / FLASH_MS) : 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = isFlashing ? 1 : 0.55;
      ctx.lineWidth = baseWidth * pulse;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Nodes.
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const isFlashNode =
        flashActive && (flash!.owners[0] === node.owner || flash!.owners[1] === node.owner);
      const isSelected = selected === node.owner;
      const isHover = hover?.owner === node.owner;
      const hue = node.agent.identity.hue;

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle =
        isFlashNode && flash!.kind === "slash" ? C.danger : `hsl(${hue} 55% 55%)`;
      ctx.fill();
      ctx.lineWidth = isSelected ? 3 : isHover ? 2 : 1;
      ctx.strokeStyle = isSelected || isHover ? C.bone : C.inkLine;
      ctx.stroke();

      if (node.agent.openJobs > 0) {
        ctx.beginPath();
        ctx.arc(node.x + node.radius * 0.72, node.y - node.radius * 0.72, 3, 0, Math.PI * 2);
        ctx.fillStyle = C.amber;
        ctx.fill();
      }

      if (node.radius > 12) {
        ctx.font = "9px var(--font-jetbrains-mono), monospace";
        ctx.fillStyle = C.bone;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.agent.identity.glyph, node.x, node.y);
      }
    }

    if (flashActive) requestAnimationFrame(draw);
  }, [selected, hover]);

  // ── Simulation lifecycle: create once, update nodes/links in place ─────
  useEffect(() => {
    const existingByOwner = new Map(nodesRef.current.map((n) => [n.owner, n]));
    const { w, h } = sizeRef.current;
    nodesRef.current = graphNodes.map((gn) => {
      const prev = existingByOwner.get(gn.owner);
      if (prev) {
        prev.agent = gn.agent;
        prev.radius = gn.radius;
        return prev;
      }
      return {
        ...gn,
        x: w / 2 + (Math.random() - 0.5) * 60,
        y: h / 2 + (Math.random() - 0.5) * 60,
      };
    });

    const nodeByOwner = new Map(nodesRef.current.map((n) => [n.owner, n]));
    linksRef.current = graphEdges
      .filter((e) => nodeByOwner.has(e.a) && nodeByOwner.has(e.b))
      .map((e) => ({ source: nodeByOwner.get(e.a)!, target: nodeByOwner.get(e.b)!, edge: e }));

    if (!simRef.current) {
      simRef.current = forceSimulation<SimNode>(nodesRef.current)
        .force("charge", forceManyBody().strength(-120))
        .force(
          "link",
          forceLink<SimNode, SimLink>(linksRef.current)
            .id((n) => n.owner)
            .distance(95)
            .strength(0.2)
        )
        .force("center", forceCenter(w / 2, h / 2))
        .force(
          "collide",
          forceCollide<SimNode>().radius((n) => n.radius + 8)
        )
        .alphaDecay(0.02)
        .on("tick", draw);
    } else {
      simRef.current.nodes(nodesRef.current);
      const linkForce = simRef.current.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>;
      linkForce?.links(linksRef.current);
      if (!hiddenRef.current) simRef.current.alpha(Math.max(simRef.current.alpha(), 0.35)).restart();
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphEdges]);

  useEffect(() => {
    const sim = simRef.current;
    return () => {
      sim?.stop();
    };
  }, []);

  // ── React to size changes ───────────────────────────────────────────────
  useEffect(() => {
    draw();
  }, [draw, size]);

  // ── Flash a settle/slash on the edge + both endpoints the instant it happens ─
  useEffect(() => {
    const newest = feed[0];
    if (!newest || newest.id === lastRowIdRef.current) return;
    lastRowIdRef.current = newest.id;
    if (!newest.consumer || !newest.provider) return;
    const kind = newest.state === "slash" ? "slash" : newest.state === "settled" ? "settle" : null;
    if (!kind) return;
    const edgeId = newest.consumer < newest.provider ? `${newest.consumer}::${newest.provider}` : `${newest.provider}::${newest.consumer}`;
    flashRef.current = { edgeId, owners: [newest.consumer, newest.provider], kind, startedAt: Date.now() };
    if (!hiddenRef.current) simRef.current?.alpha(Math.max(simRef.current.alpha(), 0.15)).restart();
    requestAnimationFrame(draw);
  }, [feed, draw]);

  // ── Pause when tab hidden ────────────────────────────────────────────────
  useEffect(() => {
    function onVisibility() {
      hiddenRef.current = document.visibilityState === "hidden";
      if (hiddenRef.current) simRef.current?.stop();
      else draw();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [draw]);

  // ── Hit testing ──────────────────────────────────────────────────────────
  function nodeAt(clientX: number, clientY: number): SimNode | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let closest: SimNode | null = null;
    let closestDist = Infinity;
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const d = Math.hypot(node.x - x, node.y - y);
      if (d <= node.radius + 4 && d < closestDist) {
        closest = node;
        closestDist = d;
      }
    }
    return closest;
  }

  function handleMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const node = nodeAt(e.clientX, e.clientY);
    setHover(node ? { owner: node.owner, clientX: e.clientX, clientY: e.clientY } : null);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const node = nodeAt(e.clientX, e.clientY);
    setSelected(node ? node.owner : null);
  }

  const hoveredAgent = hover ? nodesRef.current.find((n) => n.owner === hover.owner)?.agent : null;
  const selectedNode = selected ? graphNodes.find((n) => n.owner === selected) : null;
  const selectedEdges = selected
    ? graphEdges.filter((e) => e.a === selected || e.b === selected)
    : [];

  return (
    <div className="relative min-h-[420px] flex-1 xl:min-h-0">
      <div ref={containerRef} className="terminal-grid absolute inset-0 border border-ink-line bg-ink">
        {graphNodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-ink-faint">
            {status === "backfilling" || status === "connecting"
              ? "SYNCING · WARMING AGENT GRAPH FROM DEVNET"
              : "no agents registered yet"}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            style={{ width: size.w, height: size.h }}
            onMouseMove={handleMove}
            onMouseLeave={() => setHover(null)}
            onClick={handleClick}
            className="cursor-pointer"
          />
        )}
      </div>

      {hoveredAgent && hover && !selected && (
        <div
          className="pointer-events-none fixed z-20 max-w-[220px] border border-ink-line bg-ink-raised px-2.5 py-2 text-[10px] shadow-lg"
          style={{ left: hover.clientX + 14, top: hover.clientY + 14 }}
        >
          <div className="font-semibold text-bone">{hoveredAgent.identity.name}</div>
          <div className="mt-1 flex items-center gap-2 text-ink-faint">
            <span>${(hoveredAgent.scoreVolume / 1e6).toFixed(2)} earned</span>
            <span>·</span>
            <span className={hoveredAgent.slashEvents > 0 ? "text-danger-ink" : "text-green-ink"}>
              {hoveredAgent.slashEvents} slash{hoveredAgent.slashEvents === 1 ? "" : "es"}
            </span>
          </div>
        </div>
      )}

      {selectedNode && (
        <NetworkSidePanel
          node={selectedNode}
          edges={selectedEdges}
          allNodes={graphNodes}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
