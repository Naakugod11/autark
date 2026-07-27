import { SyncingState } from "@/components/SyncingState";

// Root-level Suspense fallback: covers "/" and "/agent/[pubkey]", the two
// server-rendered routes that await the shared chain snapshot
// (web/lib/chainCache.ts) and can genuinely block on a cold cache warm.
// /terminal never suspends here — it's a client component reading from
// EconomyProvider's already-warm subscription, with its own status states.
export default function Loading() {
  return <SyncingState />;
}
