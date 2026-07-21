import { Panel } from "./Panel";
import { FeedRowItem } from "./FeedRowItem";
import type { FeedRow, FleetAgent } from "@/lib/economy";

export function LiveFeed({
  feed,
  agents,
  eventsLast5Min,
}: {
  feed: FeedRow[];
  agents: Map<string, FleetAgent>;
  eventsLast5Min: number;
}) {
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
      <div className="terminal-grid flex-1 overflow-y-auto">
        {feed.length === 0 && (
          <div className="px-3 py-10 text-center text-[11px] text-bone-faint">
            waiting for on-chain activity…
          </div>
        )}
        {feed.map((row) => (
          <FeedRowItem key={row.id} row={row} agents={agents} />
        ))}
      </div>
    </Panel>
  );
}
