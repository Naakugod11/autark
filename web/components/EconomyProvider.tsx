"use client";

/**
 * web/components/EconomyProvider.tsx — keeps the live economy store warm
 * across client-side navigation.
 *
 * Before this existed, /terminal called useEconomy() directly. Navigating
 * away to a profile page and back unmounted and remounted the terminal page
 * component, which tore down the whole subscription and re-ran the entire
 * backfill from scratch on every return trip — the exact RPC-burst-on-
 * navigation bug this component fixes.
 *
 * Mounted once in the root layout (so it survives navigation between /,
 * /terminal, /network, and /agent/[pubkey] — all top-level siblings, so
 * only a layout above all of them persists across moves between them), but
 * the underlying subscription doesn't start until the visitor actually
 * reaches a live surface — the landing page at "/" must never open a
 * websocket, it's the walletless top-of-funnel pitch, not a live view.
 * Every OTHER route (the terminal, the network graph, agent profiles) is a
 * live surface — Task 1 added /network as a second live view alongside the
 * terminal, so this gates on "not the bare landing page" rather than
 * naming /terminal specifically. Once started, `hasVisited` never goes
 * back to false, so leaving a live route for another and returning finds
 * the store already warm.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useEconomy, type EconomyState } from "@/lib/economy";

const EconomyContext = createContext<EconomyState | null>(null);

export function EconomyProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [hasVisitedLiveSurface, setHasVisitedLiveSurface] = useState(false);

  useEffect(() => {
    if (pathname !== "/") setHasVisitedLiveSurface(true);
  }, [pathname]);

  const state = useEconomy(hasVisitedLiveSurface);

  return <EconomyContext.Provider value={state}>{children}</EconomyContext.Provider>;
}

export function useEconomyContext(): EconomyState {
  const ctx = useContext(EconomyContext);
  if (!ctx) throw new Error("useEconomyContext must be used within EconomyProvider");
  return ctx;
}
