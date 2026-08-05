import { FeedRowItem } from "./FeedRowItem";
import type { FeedRow, FleetAgent } from "@/lib/economy";

// FeedRowItem already carries a Solscan link for this row's signature (Task
// 3 — "one click from its on-chain proof" everywhere) — this footer just
// adds the slot number, which FeedRowItem doesn't show.
export function HistoryRow({ row, agents }: { row: FeedRow; agents: Map<string, FleetAgent> }) {
  return (
    <div>
      <FeedRowItem row={row} agents={agents} />
      <div className="flex items-center gap-3 border-b border-ink-line bg-ink px-3 py-1 text-[9px] text-ink-faint">
        <span>slot {row.slot}</span>
      </div>
    </div>
  );
}
