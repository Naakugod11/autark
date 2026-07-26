"use client";

import { useMemo } from "react";
import { useEconomy } from "@/lib/economy";
import { TopBar } from "@/components/TopBar";
import { FleetPanel } from "@/components/FleetPanel";
import { LiveFeed } from "@/components/LiveFeed";
import { VitalsPanel } from "@/components/VitalsPanel";
import { SlashOverlay } from "@/components/SlashOverlay";
import { ConnectionError } from "@/components/ConnectionError";

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
    // Below xl: this is a normal scrolling page (three stacked panels can
    // add up to more than one viewport's height) — the fixed h-screen,
    // internally-scrolling "terminal" layout only kicks in at xl:, where
    // the 3-column grid actually fits a single screen and each panel
    // scrolls its own overflow independently.
    <div className="flex min-h-screen flex-col overflow-y-auto bg-bone text-ink xl:h-screen xl:overflow-hidden">
      <TopBar status={status} />

      {status === "error" ? (
        <ConnectionError message={error} />
      ) : (
        <main className="grid grid-cols-1 gap-2 p-2 xl:min-h-0 xl:flex-1 xl:grid-cols-[300px_1fr_320px] xl:overflow-hidden">
          <div className="order-3 xl:order-1 xl:h-full xl:min-h-0">
            <FleetPanel agents={agents} />
          </div>
          <div className="order-1 xl:order-2 xl:h-full xl:min-h-0">
            <LiveFeed feed={feed} agents={agentsByOwner} eventsLast5Min={eventsLast5Min} />
          </div>
          <div className="order-2 xl:order-3 xl:h-full xl:min-h-0">
            <VitalsPanel
              agents={agents}
              totalSlashed={totalSlashed}
              volume24h={volume24h}
              eventsLast5Min={eventsLast5Min}
            />
          </div>
        </main>
      )}

      <SlashOverlay row={lastSlashRow} />
    </div>
  );
}
