import { AgentAvatar } from "./AgentAvatar";
import { identityFor, type AgentIdentity } from "@/lib/identity";
import { FEED_STATE_STYLE } from "@/lib/feedStyle";
import type { FeedRow, FleetAgent } from "@/lib/economy";

function identityOf(pk: string | undefined, agents: Map<string, FleetAgent>): AgentIdentity | null {
  if (!pk) return null;
  return agents.get(pk)?.identity ?? identityFor(pk);
}

export function FeedRowItem({ row, agents }: { row: FeedRow; agents: Map<string, FleetAgent> }) {
  const style = FEED_STATE_STYLE[row.state];
  const isSlash = row.state === "slash";
  const consumerId = identityOf(row.consumer, agents);
  const providerId = identityOf(row.provider, agents);
  const time = new Date(row.ts).toLocaleTimeString(undefined, { hour12: false });

  return (
    <div
      className={
        "animate-slide-in flex items-center gap-3 border-b border-ink-line px-3 py-2 " +
        (isSlash
          ? "animate-slash-shake bg-danger-dim/50 " + (style.glow ?? "")
          : "hover:bg-ink/60")
      }
    >
      <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + style.dot} />
      <span className="hidden w-[68px] shrink-0 text-[10px] tabular-nums text-bone-faint sm:inline">
        {time}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[12px] whitespace-nowrap">
        {consumerId && providerId ? (
          <>
            <AgentAvatar identity={consumerId} size={18} />
            <span className="truncate text-bone-dim">{consumerId.name}</span>
            <span className="text-bone-faint">→</span>
            {row.amount != null && (
              <span className={"font-semibold " + (isSlash ? "text-danger" : "text-amber")}>
                {(row.amount / 1e6).toFixed(2)} USDC
              </span>
            )}
            <span className="text-bone-faint">→</span>
            <AgentAvatar identity={providerId} size={18} flash={isSlash ? "slash" : undefined} />
            <span className={"truncate " + (isSlash ? "font-semibold text-danger" : "text-bone")}>
              {providerId.name}
            </span>
          </>
        ) : (
          <span className={"truncate " + (isSlash ? "font-semibold text-danger" : "text-bone")}>
            {row.headline}
          </span>
        )}
      </div>

      <span
        className={
          "shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] tracking-[0.14em] " +
          style.text +
          " " +
          style.border
        }
      >
        {style.label}
      </span>
    </div>
  );
}
