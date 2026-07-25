"use client";

import { useMemo, useState } from "react";
import { Panel } from "./Panel";
import { FeedRowItem } from "./FeedRowItem";
import { familyOf, type FeedFamily } from "@/lib/feedStyle";
import type { FeedRow, FleetAgent } from "@/lib/economy";

const FAMILY_FILTERS: { key: FeedFamily | "all"; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "settled", label: "SETTLED" },
  { key: "pending", label: "PENDING" },
  { key: "dispute", label: "DISPUTES" },
  { key: "slash", label: "SLASHES" },
];

export function LiveFeed({
  feed,
  agents,
  eventsLast5Min,
}: {
  feed: FeedRow[];
  agents: Map<string, FleetAgent>;
  eventsLast5Min: number;
}) {
  const [family, setFamily] = useState<FeedFamily | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const agentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of feed) {
      for (const pk of [row.consumer, row.provider]) {
        if (!pk || seen.has(pk)) continue;
        seen.set(pk, agents.get(pk)?.identity.name ?? pk.slice(0, 4));
      }
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [feed, agents]);

  const filtered = useMemo(() => {
    return feed.filter((row) => {
      if (family !== "all" && familyOf(row.state) !== family) return false;
      if (agentFilter !== "all" && row.consumer !== agentFilter && row.provider !== agentFilter) {
        return false;
      }
      return true;
    });
  }, [feed, family, agentFilter]);

  return (
    <Panel
      title="LIVE ECONOMY"
      className="h-full"
      bodyClassName="flex flex-col overflow-hidden"
      right={
        <span className="text-[9px] tracking-[0.14em] text-bone-faint">
          {eventsLast5Min} EVENTS / 5M
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-line px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
          {FAMILY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFamily(f.key)}
              className={
                "rounded-sm border px-1.5 py-0.5 text-[9px] tracking-[0.1em] transition-colors " +
                (family === f.key
                  ? "border-amber-dim text-amber"
                  : "border-ink-line text-bone-faint hover:text-bone-dim")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="ml-auto rounded-sm border border-ink-line bg-ink px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-bone-dim outline-none"
        >
          <option value="all">ALL AGENTS</option>
          {agentOptions.map(([pk, name]) => (
            <option key={pk} value={pk}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="terminal-grid flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-10 text-center text-[11px] text-bone-faint">
            {feed.length === 0 ? "waiting for on-chain activity…" : "no rows match this filter"}
          </div>
        )}
        {filtered.map((row) => (
          <FeedRowItem key={row.id} row={row} agents={agents} />
        ))}
      </div>
    </Panel>
  );
}
