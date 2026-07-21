"use client";

import { useMemo } from "react";
import { useEconomy } from "@/lib/economy";
import { TopBar } from "@/components/TopBar";
import { FleetPanel } from "@/components/FleetPanel";
import { LiveFeed } from "@/components/LiveFeed";
import { VitalsPanel } from "@/components/VitalsPanel";
import { SlashOverlay } from "@/components/SlashOverlay";

export default function Dashboard() {
  const { status, error, agents, feed, totalSlashed, volume24h, eventsLast5Min, lastSlashId } =
    useEconomy();

  const agentsByOwner = useMemo(() => {
    const m = new Map<string, (typeof agents)[number]>();
    for (const a of agents) m.set(a.owner, a);
    return m;
  }, [agents]);

  const lastSlashRow = useMemo(
    () => (lastSlashId ? (feed.find((r) => r.id === lastSlashId) ?? null) : null),
    [lastSlashId, feed]
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink text-bone">
      <TopBar status={status} />

      {status === "error" && (
        <div className="border-b border-danger bg-danger-dim/40 px-4 py-2 text-[11px] text-danger">
          {error ?? "connection failed"} — check NEXT_PUBLIC_SOLANA_RPC_URL
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[300px_1fr_320px]">
        <div className="order-3 min-h-[280px] xl:order-1 xl:min-h-0">
          <FleetPanel agents={agents} />
        </div>
        <div className="order-1 min-h-[420px] xl:order-2 xl:min-h-0">
          <LiveFeed feed={feed} agents={agentsByOwner} eventsLast5Min={eventsLast5Min} />
        </div>
        <div className="order-2 min-h-[320px] xl:order-3 xl:min-h-0">
          <VitalsPanel
            agents={agents}
            totalSlashed={totalSlashed}
            volume24h={volume24h}
            eventsLast5Min={eventsLast5Min}
          />
        </div>
      </main>

      <SlashOverlay row={lastSlashRow} />
    </div>
  );
}
