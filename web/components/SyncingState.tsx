// Honest "nothing is being hidden from you" state for server-rendered pages
// (landing, agent profiles) that await the shared chain snapshot
// (web/lib/chainCache.ts) — shown via Next's loading.tsx Suspense boundary
// only on a genuinely cold/stale cache warm, never as a fake spinner sitting
// in front of data that's actually already there. Mirrors the client
// terminal's own "SYNCING HISTORY" StatusPill state/wording so the two
// surfaces read as one product.
export function SyncingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink text-bone">
      <div className="flex items-center gap-2 border border-ink-line px-3 py-2 text-[10px] tracking-[0.18em] text-ink-dim">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-faint animate-pulse-dot" />
        <span>SYNCING · WARMING SNAPSHOT FROM DEVNET</span>
      </div>
    </div>
  );
}
