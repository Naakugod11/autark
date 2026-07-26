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
          (isError ? "bg-danger" : isLive ? "bg-ink animate-pulse-dot" : "bg-ink-faint")
        }
      />
      <span className={isError ? "text-danger-ink" : isLive ? "text-ink" : "text-ink-dim"}>
        {LABEL[status]}
      </span>
    </div>
  );
}
