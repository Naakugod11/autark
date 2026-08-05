import type { ConnStatus } from "@/lib/economy";

const LABEL: Record<ConnStatus, string> = {
  connecting: "CONNECTING",
  backfilling: "SYNCING HISTORY",
  live: "LIVE · DEVNET",
  error: "CONNECTION ERROR",
};

export function StatusPill({ status }: { status: ConnStatus }) {
  const isLive = status === "live";
  const isError = status === "error";
  return (
    <div className="flex items-center gap-2 border border-ink-line px-2.5 py-1 text-[10px] tracking-[0.18em]">
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (isError ? "bg-danger" : isLive ? "bg-green-ink animate-pulse-dot" : "bg-ink-faint")
        }
      />
      {/* Label text hides below sm — matches TopBar's own "AGENT ECONOMY
          TERMINAL" subtitle breakpoint. The widest label ("SYNCING HISTORY")
          combined with DemoButton's "ENTER THE ARENA" otherwise overflows a
          390px header; the dot alone still carries the live/connecting/error
          state at a glance. */}
      <span className={"hidden sm:inline " + (isError ? "text-danger-ink" : isLive ? "text-green-ink" : "text-ink-dim")}>
        {LABEL[status]}
      </span>
    </div>
  );
}
