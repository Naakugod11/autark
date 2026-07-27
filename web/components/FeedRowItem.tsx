import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import { identityFor, type AgentIdentity } from "@/lib/identity";
import { familyStyleOf } from "@/lib/feedStyle";
import type { FeedRow, FleetAgent } from "@/lib/economy";

function identityOf(pk: string | undefined, agents: Map<string, FleetAgent>): AgentIdentity | null {
  if (!pk) return null;
  return agents.get(pk)?.identity ?? identityFor(pk);
}

function AgentLink({
  pk,
  identity,
  size,
  className,
  bold,
  flash,
}: {
  pk: string;
  identity: AgentIdentity;
  size: number;
  className: string;
  bold?: boolean;
  flash?: "slash";
}) {
  return (
    <Link href={`/agent/${pk}`} className="flex min-w-0 shrink items-center gap-1.5 hover:underline">
      <AgentAvatar identity={identity} size={size} flash={flash} />
      <span className={"truncate " + className + (bold ? " font-semibold" : "")}>{identity.name}</span>
    </Link>
  );
}

export function FeedRowItem({ row, agents }: { row: FeedRow; agents: Map<string, FleetAgent> }) {
  const style = familyStyleOf(row.state);
  const isSlash = row.state === "slash";
  const consumerId = identityOf(row.consumer, agents);
  const providerId = identityOf(row.provider, agents);
  const time = new Date(row.ts).toLocaleTimeString(undefined, { hour12: false });

  return (
    <div
      className={
        "animate-slide-in flex items-center gap-2.5 border-b border-ink-line px-3 py-2 " +
        style.ruleWidth + " " + style.accent + " " + style.wash + " " +
        (isSlash ? "animate-slash-shake" : "hover:bg-bone/[0.05]")
      }
    >
      <span className={"w-3 shrink-0 text-center text-[11px] leading-none " + style.glyphColor}>{style.glyph}</span>
      <span className={"hidden w-[68px] shrink-0 text-[10px] tabular-nums sm:inline " + style.dim}>
        {time}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[12px] whitespace-nowrap">
        {consumerId && providerId && row.consumer && row.provider ? (
          <>
            <AgentLink pk={row.consumer} identity={consumerId} size={18} className={style.dim} />
            <span className={"shrink-0 " + style.dim}>→</span>
            {row.amount != null && (
              <span className={"shrink-0 font-semibold " + style.amount}>
                {(row.amount / 1e6).toFixed(2)} USDC
              </span>
            )}
            <span className={"shrink-0 " + style.dim}>→</span>
            <AgentLink
              pk={row.provider}
              identity={providerId}
              size={18}
              className={style.text}
              bold={isSlash}
              flash={isSlash ? "slash" : undefined}
            />
          </>
        ) : (
          <span className={"truncate " + style.text + (isSlash ? " font-semibold" : "")}>
            {row.headline}
          </span>
        )}
      </div>

      <span
        className={
          "shrink-0 border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.14em] " +
          style.badgeText + " " + style.badgeBorder + " " + style.badgeFill
        }
      >
        {row.badge}
      </span>
    </div>
  );
}
