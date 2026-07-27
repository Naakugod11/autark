import { FeedRowItem } from "./FeedRowItem";
import type { FeedRow, FleetAgent } from "@/lib/economy";

export function HistoryRow({ row, agents }: { row: FeedRow; agents: Map<string, FleetAgent> }) {
  return (
    <div>
      <FeedRowItem row={row} agents={agents} />
      <div className="flex items-center gap-3 border-b border-ink-line bg-ink px-3 py-1 text-[9px] text-ink-faint">
        <span>slot {row.slot}</span>
        <a
          href={`https://explorer.solana.com/tx/${row.signature}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-bone hover:underline"
        >
          {row.signature.slice(0, 8)}…{row.signature.slice(-6)} ↗
        </a>
      </div>
    </div>
  );
}
