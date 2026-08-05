"use client";

/**
 * web/components/NetworkGraph.tsx — Task 1's live agent economic-interaction
 * graph. Canvas + d3-force, fed by the SAME useEconomyContext() store the
 * terminal reads (web/lib/economy.ts) for NODES and for incremental live
 * events, plus a server-computed base graph (web/lib/chainCache.ts's
 * getRelationships(), passed down from app/network/page.tsx) for EDGES —
 * see web/lib/graph.ts's mergeGraphEdges/mergeFeedRows header notes for why
 * edges can't come from the client's live feed alone (its ~120-event
 * backfill window silently drops older relationships that the full agent
 * snapshot still shows as nodes, rendering them as disconnected dots).
 *
 * Node = a registered agent, sized by stake+volume. Edge = an aggregated
 * consumer<->provider relationship, colored by the same four-state family
 * system as the feed (settled/pending/dispute/slash), sticky toward the
 * worst outcome ever seen on that edge, width/opacity scaled by the pair's
 * total settled volume (always at least a visible hairline — this is the
 * honest "who's economically connected to whom" picture, and a thin edge
 * still means "connected", not "nothing here"). A relationship with a
 * currently open job gets a marching-dash treatment so "active right now"
 * reads at a glance without needing to click through.
 *
 * Interaction (Task 2): the view (pan x/y, zoom k) is a separate transform
 * from the simulation's own world coordinates — draw() applies it once via
 * ctx.translate/scale, and every hit-test (node/edge picking, drag) inverts
 * it back to world space. Pointer Events (not separate mouse/touch handlers)
 * unify desktop drag/pan/click with mobile drag/pan/tap; a second pointer
 * turns single-finger pan into pinch-zoom. Dragging a node pins it (fx/fy)
 * while the pointer is down and releases it back to the simulation on
 * release — chosen over "stays pinned" so a dragged graph keeps feeling
 * alive/physical rather than accumulating permanently frozen nodes.
 *
 * Simulation settles (alpha decays to ~0) and idles — no redraw loop running
 * while nothing is moving or animating. A live event briefly reheats it
 * (small alpha bump) so new nodes/edges visibly settle into place instead of
 * teleporting; an in-flight edge's marching dash runs its own lightweight
 * rAF loop independent of the physics tick. Paused entirely on tab-hidden
 * via the Page Visibility API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  buildGraphNodes,
  mergeGraphEdges,
  mergeFeedRows,
  type GraphNode,
  type GraphEdge,
} from "@/lib/graph";
import { NetworkSidePanel } from "./NetworkSidePanel";
import { NetworkEdgePanel } from "./NetworkEdgePanel";
import type { FeedFamily } from "@/lib/feedStyle";
import type { FeedRow } from "@/lib/economy";

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
type Selection = { kind: "node"; owner: string } | { kind: "edge"; id: string } | null;
type View = { x: number; y: number; k: number };
type PointerPt = { x: number; y: number };

const FLASH_MS = 1500;
const MIN_K = 0.35;
const MAX_K = 3.5;
const DRAG_THRESHOLD_PX = 6; // beyond this, a pointerdown->up is a drag/pan, not a tap/click
const TOUCH_HIT_EXTRA_PX = 16; // extra hit radius for touch, on top of the mouse padding below
const MOUSE_HIT_PADDING_PX = 4;
const EDGE_HIT_BASE_PX = 6;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Standard point-to-segment distance, used for edge hit-testing.
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = clamp(t, 0, 1);
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function NetworkGraph({
  baseEdges,
  baseRows,
  baseMaxTs,
}: {
  baseEdges: GraphEdge[];
  baseRows: FeedRow[];
  baseMaxTs: number;
}) {
  const { agents, feed, status } = useEconomyContext();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const flashRef = useRef<Flash | null>(null);
  const lastRowIdRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 800, h: 520 });
  const hiddenRef = useRef(false);
  const maxVolumeRef = useRef(1);

  // ── View transform + interaction state (Task 2) ─────────────────────────
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const pointersRef = useRef<Map<number, PointerPt>>(new Map());
  const dragRef = useRef<{ owner: string; pointerId: number } | null>(null);
  const panRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const pinchRef = useRef<{ startDist: number; startK: number; startMidClient: PointerPt; startView: View } | null>(null);
  const downInfoRef = useRef<{ clientX: number; clientY: number; moved: boolean } | null>(null);

  const [size, setSize] = useState({ w: 800, h: 520 });
  const [hover, setHover] = useState<{ owner: string; clientX: number; clientY: number } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  const { nodes: graphNodes, edges: graphEdges } = useMemo(() => {
    const edges = mergeGraphEdges(baseEdges, feed, baseMaxTs);
    // edges first: buildGraphNodes needs the edge list to synthesize a
    // minimal node for any counterparty that isn't a registered agent (see
    // graph.ts's ghostNode) — otherwise a real relationship with a plain
    // wallet consumer would have nothing to connect to.
    return { nodes: buildGraphNodes(agents, edges), edges };
  }, [agents, feed, baseEdges, baseMaxTs]);

  const allRows = useMemo(
    () => mergeFeedRows(baseRows, feed, baseMaxTs),
    [baseRows, feed, baseMaxTs]
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
    const view = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);

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
      // Always-visible hairline floor, scaled up by the pair's total settled
      // volume so a whale relationship reads as visibly thicker/bolder than
      // a one-off — never all the way down to invisible, a quiet
      // relationship is still a real one.
      const volumeFactor = Math.sqrt(Math.max(0, link.edge.totalVolume) / maxVolumeRef.current);
      const width = (baseWidth + volumeFactor * 3) * pulse;
      const opacity = isFlashing ? 1 : 0.35 + volumeFactor * 0.45;

      ctx.setLineDash(link.edge.hasOpenJob && !isFlashing ? [6 / view.k, 5 / view.k] : []);
      if (link.edge.hasOpenJob && !isFlashing) {
        ctx.lineDashOffset = -(performance.now() / 40) % 11;
      }
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = width / view.k;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);

    // Nodes.
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const isFlashNode =
        flashActive && (flash!.owners[0] === node.owner || flash!.owners[1] === node.owner);
      const isSelected = selection?.kind === "node" && selection.owner === node.owner;
      const isHover = hover?.owner === node.owner;
      const hue = node.agent.identity.hue;

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle =
        isFlashNode && flash!.kind === "slash" ? C.danger : `hsl(${hue} 55% 55%)`;
      ctx.fill();
      ctx.lineWidth = (isSelected ? 3 : isHover ? 2 : 1) / view.k;
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

    ctx.restore();

    if (flashActive) requestAnimationFrame(draw);
  }, [selection, hover]);

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

    maxVolumeRef.current = Math.max(1, ...graphEdges.map((e) => e.totalVolume));

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

  // ── Marching-dash animation loop for in-flight edges ────────────────────
  // Independent of the physics tick — the simulation idles once settled,
  // but a dashed "job in flight" edge still needs to visibly march. Only
  // runs while at least one edge actually has an open job, and still
  // respects tab-hidden (skips the draw, not the rAF chain itself — modern
  // browsers throttle background rAF on their own regardless).
  useEffect(() => {
    if (!graphEdges.some((e) => e.hasOpenJob)) return;
    let raf: number;
    function loop() {
      if (!hiddenRef.current) draw();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [graphEdges, draw]);

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

  // ── Wheel = desktop zoom (native listener: must be non-passive to preventDefault) ─
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.001);
      const view = viewRef.current;
      const newK = clamp(view.k * factor, MIN_K, MAX_K);
      viewRef.current = {
        x: cx - (cx - view.x) * (newK / view.k),
        y: cy - (cy - view.y) * (newK / view.k),
        k: newK,
      };
      draw();
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [draw, graphNodes.length]);

  // ── Coordinate + hit-testing helpers ────────────────────────────────────
  function screenToWorld(clientX: number, clientY: number): PointerPt {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  }

  function nodeAt(wx: number, wy: number, extraPx: number): SimNode | null {
    const k = viewRef.current.k;
    let closest: SimNode | null = null;
    let closestDist = Infinity;
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const d = Math.hypot(node.x - wx, node.y - wy);
      const threshold = node.radius + (MOUSE_HIT_PADDING_PX + extraPx) / k;
      if (d <= threshold && d < closestDist) {
        closest = node;
        closestDist = d;
      }
    }
    return closest;
  }

  function edgeAt(wx: number, wy: number, extraPx: number): SimLink | null {
    const k = viewRef.current.k;
    const threshold = (EDGE_HIT_BASE_PX + extraPx) / k;
    let closest: SimLink | null = null;
    let closestDist = Infinity;
    for (const link of linksRef.current) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
      const d = distToSegment(wx, wy, s.x, s.y, t.x, t.y);
      if (d <= threshold && d < closestDist) {
        closest = link;
        closestDist = d;
      }
    }
    return closest;
  }

  // ── Pointer events: drag node / pan canvas / pinch zoom / tap select ────
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      pinchRef.current = {
        startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        startK: viewRef.current.k,
        startMidClient: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        startView: { ...viewRef.current },
      };
      dragRef.current = null;
      panRef.current = null;
      downInfoRef.current = null;
      return;
    }

    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const extraPx = e.pointerType === "touch" ? TOUCH_HIT_EXTRA_PX : 0;
    const node = nodeAt(wx, wy, extraPx);
    downInfoRef.current = { clientX: e.clientX, clientY: e.clientY, moved: false };

    if (node) {
      dragRef.current = { owner: node.owner, pointerId: e.pointerId };
      node.fx = node.x;
      node.fy = node.y;
      if (!hiddenRef.current) simRef.current?.alphaTarget(0.3).restart();
    } else {
      panRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: viewRef.current.x,
        startY: viewRef.current.y,
      };
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinchRef.current && pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const pinch = pinchRef.current;
      const newK = clamp(pinch.startK * (dist / pinch.startDist), MIN_K, MAX_K);
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const cx = pinch.startMidClient.x - rect.left;
        const cy = pinch.startMidClient.y - rect.top;
        viewRef.current = {
          x: cx - (cx - pinch.startView.x) * (newK / pinch.startK),
          y: cy - (cy - pinch.startView.y) * (newK / pinch.startK),
          k: newK,
        };
        draw();
      }
      return;
    }

    if (downInfoRef.current) {
      const dx = e.clientX - downInfoRef.current.clientX;
      const dy = e.clientY - downInfoRef.current.clientY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) downInfoRef.current.moved = true;
    }

    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      const node = nodesRef.current.find((n) => n.owner === dragRef.current!.owner);
      if (node) {
        const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
        node.fx = wx;
        node.fy = wy;
      }
      return;
    }

    if (panRef.current && panRef.current.pointerId === e.pointerId) {
      const pan = panRef.current;
      viewRef.current = {
        ...viewRef.current,
        x: pan.startX + (e.clientX - pan.startClientX),
        y: pan.startY + (e.clientY - pan.startClientY),
      };
      draw();
      return;
    }

    // Desktop hover tooltip — mouse only; touch has no hover, it taps instead.
    if (e.pointerType === "mouse") {
      const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
      const node = nodeAt(wx, wy, 0);
      setHover(node ? { owner: node.owner, clientX: e.clientX, clientY: e.clientY } : null);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;

    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      const node = nodesRef.current.find((n) => n.owner === dragRef.current!.owner);
      // Release back to the simulation rather than staying pinned — see
      // header note on why this codebase chose "let go" over "stays put".
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      dragRef.current = null;
      if (!hiddenRef.current) simRef.current?.alphaTarget(0);
    }
    if (panRef.current && panRef.current.pointerId === e.pointerId) {
      panRef.current = null;
    }

    const info = downInfoRef.current;
    downInfoRef.current = null;
    if (!info || info.moved) return; // a drag/pan, not a tap/click

    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const extraPx = e.pointerType === "touch" ? TOUCH_HIT_EXTRA_PX : 0;
    const node = nodeAt(wx, wy, extraPx);

    if (node) {
      // Touch: first tap selects (the panel IS the tooltip, since touch has
      // no hover) — tapping the SAME already-selected node again goes
      // through to the profile, matching the desktop pattern where the
      // panel's own "VIEW FULL PROFILE" link is the second click.
      if (e.pointerType === "touch" && selection?.kind === "node" && selection.owner === node.owner) {
        router.push(`/agent/${node.owner}`);
        return;
      }
      setSelection({ kind: "node", owner: node.owner });
      return;
    }

    const edge = edgeAt(wx, wy, extraPx);
    if (edge) {
      setSelection({ kind: "edge", id: edge.edge.id });
      return;
    }

    setSelection(null);
  }

  function handlePointerLeave(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "mouse") setHover(null);
  }

  function resetView() {
    viewRef.current = { x: 0, y: 0, k: 1 };
    draw();
  }

  const hoveredAgent = hover ? nodesRef.current.find((n) => n.owner === hover.owner)?.agent : null;
  const selectedNode = selection?.kind === "node" ? graphNodes.find((n) => n.owner === selection.owner) : null;
  const selectedNodeEdges = selectedNode
    ? graphEdges.filter((e) => e.a === selectedNode.owner || e.b === selectedNode.owner)
    : [];
  const selectedNodeRows = selectedNode
    ? allRows.filter((r) => r.consumer === selectedNode.owner || r.provider === selectedNode.owner)
    : [];

  const selectedEdge = selection?.kind === "edge" ? graphEdges.find((e) => e.id === selection.id) : null;
  const byOwnerForEdge = new Map(graphNodes.map((n) => [n.owner, n]));
  const selectedEdgeA = selectedEdge ? byOwnerForEdge.get(selectedEdge.a) ?? null : null;
  const selectedEdgeB = selectedEdge ? byOwnerForEdge.get(selectedEdge.b) ?? null : null;
  const selectedEdgeRows = selectedEdge
    ? allRows.filter(
        (r) =>
          (r.consumer === selectedEdge.a && r.provider === selectedEdge.b) ||
          (r.consumer === selectedEdge.b && r.provider === selectedEdge.a)
      )
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
            style={{ width: size.w, height: size.h, touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            className="cursor-pointer"
          />
        )}
      </div>

      {graphNodes.length > 0 && (
        <button
          type="button"
          onClick={resetView}
          className="absolute right-2 top-2 z-10 border border-ink-line bg-ink-raised px-2 py-1 text-[9px] tracking-[0.14em] text-ink-faint hover:text-bone"
        >
          RESET VIEW
        </button>
      )}

      {hoveredAgent && hover && !selection && (
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
          edges={selectedNodeEdges}
          allNodes={graphNodes}
          rows={selectedNodeRows}
          onClose={() => setSelection(null)}
        />
      )}

      {selectedEdge && (
        <NetworkEdgePanel
          edge={selectedEdge}
          a={selectedEdgeA}
          b={selectedEdgeB}
          rows={selectedEdgeRows}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}
