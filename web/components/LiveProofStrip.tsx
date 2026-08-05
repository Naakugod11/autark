"use client";

/**
 * web/components/LiveProofStrip.tsx — Task 4: the landing page's proof strip
 * (ACTIVE AGENTS / 24H VOLUME / TOTAL SLASHED / LAST EVENT) must actually
 * move while a visitor is watching, not just sit at whatever the server
 * rendered.
 *
 * Deliberately NOT wired through EconomyProvider/useEconomy() (the full
 * store the terminal and network graph share) — that hook's `stream()` call
 * always runs a ~120-event backfill before going live, which is exactly the
 * "full backfill" this strip is supposed to stay clear of so the landing
 * page's first paint stays fast and wallet-less-visitor-friendly. Instead:
 *
 *   1. Hydrate from the server snapshot (web/lib/landingStats.ts, already
 *      rendered into the page before this ever mounts).
 *   2. One cheap fetchAgents() call (NOT the expensive event backfill — see
 *      chainCache.ts's own cost-split reasoning) seeds a local
 *      owner->openJobs map, needed because "how many agents are active"
 *      can only be tracked incrementally if you know which owners already
 *      had an open job before this tab started watching.
 *   3. events.ts's `subscribe()` (not `stream()`) attaches a events-only
 *      listener with NO backfill — every event after this point is new
 *      information, folded onto the server baseline.
 *   4. A 1s interval just forces a re-render so "LAST EVENT" keeps ticking
 *      even when nothing new has happened.
 *
 * Best-effort throughout: if RPC init fails, the strip simply stays frozen
 * at the server-rendered snapshot — never worse than what the page already
 * had, never a visible error on the landing page.
 */

import { useEffect, useRef, useState } from "react";
import { getProgram, fetchAgents } from "@/lib/autark";
import { subscribe, type AutarkEventHandlers } from "@/lib/events";
import { fmtUsd, timeAgo } from "@/lib/format";

export type ProofStripStats = {
  activeAgents: number;
  volume24h: number;
  totalSlashed: number;
  lastEventAt: number | null;
};

function useLiveProofStrip(initial: ProofStripStats): ProofStripStats {
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    const openJobsByOwner = new Map<string, number>();

    function commit(patch: Partial<ProofStripStats>) {
      stateRef.current = { ...stateRef.current, lastEventAt: Date.now(), ...patch };
      if (!cancelled) setState(stateRef.current);
    }

    function activeCount(): number {
      let n = 0;
      for (const v of openJobsByOwner.values()) if (v > 0) n++;
      return n;
    }

    async function init() {
      try {
        const program = getProgram();
        const agents = await fetchAgents(program);
        if (cancelled) return;
        for (const a of agents) openJobsByOwner.set(a.owner.toBase58(), a.openJobs);

        const handlers: AutarkEventHandlers = {
          jobProposed: () => commit({}),
          jobAccepted: (e) => {
            openJobsByOwner.set(e.data.provider.toBase58(), e.data.providerOpenJobs);
            commit({ activeAgents: activeCount() });
          },
          settlementPendingEvent: () => commit({}),
          jobSettled: (e) => {
            const owner = e.data.provider.toBase58();
            openJobsByOwner.set(owner, Math.max(0, (openJobsByOwner.get(owner) ?? 1) - 1));
            commit({ activeAgents: activeCount(), volume24h: stateRef.current.volume24h + e.data.amount.toNumber() });
          },
          bountyPosted: () => commit({}),
          bidSubmitted: () => commit({}),
          bountyAwarded: () => commit({}),
          challengeOpened: () => commit({}),
          challengeDefended: () => commit({}),
          challengeResolved: (e) => {
            const isSlash = !e.data.defended && e.data.slashed.toNumber() > 0;
            commit(isSlash ? { totalSlashed: stateRef.current.totalSlashed + e.data.slashed.toNumber() } : {});
          },
          jobRejected: () => commit({}),
          jobExpired: (e) => {
            const owner = e.data.provider.toBase58();
            openJobsByOwner.set(owner, Math.max(0, (openJobsByOwner.get(owner) ?? 1) - 1));
            const slashed = e.data.slashed.toNumber();
            commit({ activeAgents: activeCount(), ...(slashed > 0 ? { totalSlashed: stateRef.current.totalSlashed + slashed } : {}) });
          },
          jobAbandoned: (e) => {
            const owner = e.data.provider.toBase58();
            openJobsByOwner.set(owner, Math.max(0, (openJobsByOwner.get(owner) ?? 1) - 1));
            const slashed = e.data.slashed.toNumber();
            commit({ activeAgents: activeCount(), ...(slashed > 0 ? { totalSlashed: stateRef.current.totalSlashed + slashed } : {}) });
          },
        };
        unsub = subscribe(program, handlers, {});
      } catch {
        // Best-effort — an RPC hiccup just leaves the strip at its
        // server-rendered snapshot rather than surfacing an error.
      }
    }
    init();

    return () => {
      cancelled = true;
      unsub?.();
    };
    // Only ever seeds from the FIRST server snapshot this component mounted
    // with — a changed `initial` prop (there isn't one across this page's
    // lifetime) intentionally wouldn't restart the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

// Forces a re-render every second purely so "LAST EVENT" keeps ticking
// (Xs ago -> X+1s ago) even when no new on-chain event has landed.
function useNowTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

export function LiveProofStrip({ initial }: { initial: ProofStripStats }) {
  const stats = useLiveProofStrip(initial);
  useNowTick();

  return (
    <section className="border-y border-ink-line bg-ink-raised">
      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-px sm:grid-cols-4">
        <ProofStat label="ACTIVE AGENTS" value={String(stats.activeAgents)} />
        <ProofStat label="24H VOLUME" value={fmtUsd(stats.volume24h)} accent />
        <ProofStat label="TOTAL SLASHED" value={fmtUsd(stats.totalSlashed)} danger />
        <ProofStat label="LAST EVENT" value={timeAgo(stats.lastEventAt)} />
      </div>
      <p className="px-4 py-2 text-center text-[9px] tracking-[0.14em] text-ink-faint">
        LIVE FROM SOLANA DEVNET · SAME READ PATH AS THE TERMINAL
      </p>
    </section>
  );
}

function ProofStat({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="border-x border-ink-line bg-ink-raised px-3 py-5 text-center first:border-l-0 last:border-r-0 sm:first:border-l">
      <div className={"text-[26px] font-bold tabular-nums sm:text-[32px] " + (danger ? "text-danger-ink" : accent ? "text-amber-ink" : "text-bone")}>
        {value}
      </div>
      <div className="mt-1 text-[9px] tracking-[0.14em] text-ink-faint">{label}</div>
    </div>
  );
}
