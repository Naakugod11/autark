"use client";

/**
 * web/lib/economy.ts — the live economy store.
 *
 * One subscription, one code path for past + live rows (per events.ts's
 * stream()). Every mutation — fleet scores, leaderboard rank, total slashed —
 * is patched directly from the event payload that just arrived. No refetch.
 *
 * totalSlashed is seeded from SlashingPool.totalSlashed (the on-chain ground
 * truth, which already includes all history), then incremented only by
 * slashes that arrive *after* backfill completes — summing backfilled slash
 * events on top of that baseline would double-count them.
 */

import { useEffect, useRef, useState } from "react";
import { getProgram, fetchAgents, fetchSlashingPool } from "./autark";
import { stream, type AutarkEvent, type AutarkEventHandlers } from "./events";
import { identityFor, type AgentIdentity } from "./identity";

export type FeedState =
  | "proposed" | "accepted" | "pending" | "settled" | "bounty"
  | "challenged" | "defended" | "slash" | "rejected" | "expired" | "abandoned";

export type FeedRow = {
  id: string;
  slot: number;
  signature: string;
  ts: number; // ms — blockTime when known (backfill), else receipt time (live)
  kind: AutarkEvent["name"];
  state: FeedState;
  consumer?: string;
  provider?: string;
  amount?: number; // micro-USDC
  slashed?: number; // micro-USDC, only set on slash rows
  headline: string;
  badge: string;
};

export type FleetAgent = {
  owner: string;
  pubkey: string;
  identity: AgentIdentity;
  capabilities: string[];
  stakeAmount: number;
  scoreCompleted: number;
  scoreFailed: number;
  scoreVolume: number;
  slashEvents: number;
  lastSlashSlot: number;
  openJobs: number;
  createdAt: number;
  justSlashed?: number;
  justSettled?: number;
};

export type ConnStatus = "connecting" | "backfilling" | "live" | "error";

export type EconomyState = {
  status: ConnStatus;
  error: string | null;
  agents: FleetAgent[];
  feed: FeedRow[];
  totalSlashed: number;
  volume24h: number;
  eventsLast5Min: number;
  lastSlashId: string | null;
};

const INITIAL_STATE: EconomyState = {
  status: "connecting",
  error: null,
  agents: [],
  feed: [],
  totalSlashed: 0,
  volume24h: 0,
  eventsLast5Min: 0,
  lastSlashId: null,
};

const FEED_CAP = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

function fmtUsdc(micro: number): string {
  return (micro / 1e6).toFixed(2);
}

export function useEconomy(): EconomyState {
  const [state, setState] = useState<EconomyState>(INITIAL_STATE);

  const agentsMapRef = useRef<Map<string, FleetAgent>>(new Map());
  const jobsMapRef = useRef<Map<string, { consumer: string; provider: string; amount: number }>>(new Map());
  const feedRef = useRef<FeedRow[]>([]);
  const totalSlashedRef = useRef(0);
  const liveRef = useRef(false);
  const lastSlashIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    let unsub: ReturnType<typeof stream> | null = null;

    const program = getProgram();

    function nameOf(pk: string | undefined): string {
      if (!pk) return "unknown";
      return agentsMapRef.current.get(pk)?.identity.name ?? identityFor(pk).name;
    }

    function upsertAgent(owner: string, patch: Partial<FleetAgent>) {
      const existing = agentsMapRef.current.get(owner);
      if (!existing) return;
      agentsMapRef.current.set(owner, { ...existing, ...patch });
    }

    function ensureJob(job: string, consumer: string, provider: string, amount: number) {
      const existing = jobsMapRef.current.get(job);
      jobsMapRef.current.set(job, {
        consumer: consumer || existing?.consumer || "",
        provider: provider || existing?.provider || "",
        amount: amount || existing?.amount || 0,
      });
    }

    function pushFeed(row: FeedRow) {
      feedRef.current = [row, ...feedRef.current].slice(0, FEED_CAP);
      if (row.state === "slash") lastSlashIdRef.current = row.id;
    }

    function makeRow(
      e: AutarkEvent,
      rowState: FeedState,
      consumer: string | undefined,
      provider: string | undefined,
      amount: number | undefined,
      headline: string,
      badge: string
    ): FeedRow {
      return {
        id: `${e.signature}:${e.name}:${feedRef.current.length}:${Math.random().toString(36).slice(2, 8)}`,
        slot: e.slot,
        signature: e.signature,
        ts: e.blockTime != null ? e.blockTime * 1000 : Date.now(),
        kind: e.name,
        state: rowState,
        consumer,
        provider,
        amount,
        headline,
        badge,
      };
    }

    function flush() {
      if (cancelled) return;
      const now = Date.now();
      const feed = feedRef.current;
      const volume24h = feed.reduce((sum, r) => {
        if (r.state !== "settled" || !r.amount) return sum;
        return now - r.ts <= DAY_MS ? sum + r.amount : sum;
      }, 0);
      const eventsLast5Min = feed.reduce(
        (n, r) => (now - r.ts <= FIVE_MIN_MS ? n + 1 : n),
        0
      );
      setState({
        status: liveRef.current ? "live" : "backfilling",
        error: null,
        agents: Array.from(agentsMapRef.current.values()),
        feed,
        totalSlashed: totalSlashedRef.current,
        volume24h,
        eventsLast5Min,
        lastSlashId: lastSlashIdRef.current,
      });
    }

    async function init() {
      try {
        const [agents, pool] = await Promise.all([
          fetchAgents(program),
          fetchSlashingPool(program),
        ]);
        if (cancelled) return;

        for (const a of agents) {
          const owner = a.owner.toBase58();
          agentsMapRef.current.set(owner, {
            owner,
            pubkey: a.pubkey.toBase58(),
            identity: identityFor(owner),
            capabilities: a.capabilities,
            stakeAmount: a.stakeAmount,
            scoreCompleted: a.scoreCompleted,
            scoreFailed: a.scoreFailed,
            scoreVolume: a.scoreVolume,
            slashEvents: a.slashEvents,
            lastSlashSlot: a.lastSlashSlot,
            openJobs: a.openJobs,
            createdAt: a.createdAt,
          });
        }
        totalSlashedRef.current = pool?.totalSlashed ?? 0;
        flush();

        const handlers: AutarkEventHandlers = {
          jobProposed: (e) => {
            const job = e.data.job.toBase58();
            const consumer = e.data.consumer.toBase58();
            const provider = e.data.provider.toBase58();
            const amount = e.data.amount.toNumber();
            ensureJob(job, consumer, provider, amount);
            pushFeed(
              makeRow(e, "proposed", consumer, provider, amount,
                `${nameOf(consumer)} → ${fmtUsdc(amount)} USDC → ${nameOf(provider)}`,
                "PROPOSED")
            );
            flush();
          },
          jobAccepted: (e) => {
            const job = e.data.job.toBase58();
            const provider = e.data.provider.toBase58();
            const amount = e.data.amount.toNumber();
            const ref = jobsMapRef.current.get(job);
            ensureJob(job, ref?.consumer ?? "", provider, amount);
            upsertAgent(provider, { openJobs: e.data.providerOpenJobs });
            pushFeed(
              makeRow(e, "accepted", ref?.consumer, provider, amount,
                `${nameOf(ref?.consumer)} → ${fmtUsdc(amount)} USDC → ${nameOf(provider)}`,
                "ACCEPTED · ESCROW")
            );
            flush();
          },
          settlementPendingEvent: (e) => {
            const job = e.data.job.toBase58();
            const provider = e.data.provider.toBase58();
            const ref = jobsMapRef.current.get(job);
            pushFeed(
              makeRow(e, "pending", ref?.consumer, provider, ref?.amount,
                `${nameOf(ref?.consumer)} → ${ref?.amount != null ? fmtUsdc(ref.amount) : "—"} USDC → ${nameOf(provider)}`,
                "SETTLEMENT PENDING")
            );
            flush();
          },
          jobSettled: (e) => {
            const job = e.data.job.toBase58();
            const provider = e.data.provider.toBase58();
            const amount = e.data.amount.toNumber();
            const ref = jobsMapRef.current.get(job);
            const prevOpen = agentsMapRef.current.get(provider)?.openJobs ?? 1;
            upsertAgent(provider, {
              scoreCompleted: e.data.scoreCompleted.toNumber(),
              scoreVolume: e.data.scoreVolume.toNumber(),
              scoreFailed: e.data.scoreFailed.toNumber(),
              openJobs: Math.max(0, prevOpen - 1),
              justSettled: Date.now(),
            });
            pushFeed(
              makeRow(e, "settled", ref?.consumer, provider, amount,
                `${nameOf(ref?.consumer)} → ${fmtUsdc(amount)} USDC → ${nameOf(provider)}`,
                "SETTLED")
            );
            flush();
          },
          bountyPosted: (e) => {
            const poster = e.data.poster.toBase58();
            const maxAmount = e.data.maxAmount.toNumber();
            pushFeed(
              makeRow(e, "bounty", poster, undefined, maxAmount,
                `${nameOf(poster)} posts bounty · ${e.data.capabilityRequired} · up to ${fmtUsdc(maxAmount)} USDC`,
                "BOUNTY OPEN")
            );
            flush();
          },
          bidSubmitted: (e) => {
            const bidder = e.data.bidder.toBase58();
            const price = e.data.price.toNumber();
            pushFeed(
              makeRow(e, "bounty", undefined, bidder, price,
                `${nameOf(bidder)} bids ${fmtUsdc(price)} USDC on open bounty`,
                "BID")
            );
            flush();
          },
          bountyAwarded: (e) => {
            const job = e.data.job.toBase58();
            const consumer = e.data.poster.toBase58();
            const provider = e.data.provider.toBase58();
            const amount = e.data.price.toNumber();
            ensureJob(job, consumer, provider, amount);
            pushFeed(
              makeRow(e, "accepted", consumer, provider, amount,
                `${nameOf(consumer)} → ${fmtUsdc(amount)} USDC → ${nameOf(provider)}`,
                "BOUNTY AWARDED")
            );
            flush();
          },
          challengeOpened: (e) => {
            const job = e.data.job.toBase58();
            const challenger = e.data.challenger.toBase58();
            const defender = e.data.defender.toBase58();
            const amount = e.data.amount.toNumber();
            const ref = jobsMapRef.current.get(job);
            pushFeed(
              makeRow(e, "challenged", challenger, defender, ref?.amount ?? amount,
                `${nameOf(challenger)} challenges ${nameOf(defender)} · ${fmtUsdc(amount)} USDC at stake`,
                "DISPUTE OPEN")
            );
            flush();
          },
          challengeDefended: (e) => {
            const defender = e.data.defender.toBase58();
            pushFeed(
              makeRow(e, "defended", undefined, defender, e.data.amount.toNumber(),
                `${nameOf(defender)} defends the challenge · stake returned`,
                "DEFENDED")
            );
            flush();
          },
          challengeResolved: (e) => {
            const job = e.data.job.toBase58();
            const ref = jobsMapRef.current.get(job);
            const provider = ref?.provider;
            const slashed = e.data.slashed.toNumber();
            const isSlash = !e.data.defended && slashed > 0;

            if (provider) {
              const prevSlashEvents = agentsMapRef.current.get(provider)?.slashEvents ?? 0;
              upsertAgent(provider, {
                scoreCompleted: e.data.providerScoreCompleted.toNumber(),
                scoreVolume: e.data.providerScoreVolume.toNumber(),
                scoreFailed: e.data.providerScoreFailed.toNumber(),
                ...(isSlash
                  ? { slashEvents: prevSlashEvents + 1, lastSlashSlot: e.slot, justSlashed: Date.now() }
                  : {}),
              });
            }
            if (isSlash && liveRef.current) totalSlashedRef.current += slashed;

            const row = makeRow(
              e,
              isSlash ? "slash" : "defended",
              ref?.consumer,
              provider,
              ref?.amount,
              isSlash
                ? `${nameOf(provider)} SLASHED · −${fmtUsdc(slashed)} USDC · challenge upheld`
                : `${nameOf(provider)} defended · challenge dismissed`,
              isSlash ? "SLASHED" : "DEFENDED"
            );
            if (isSlash) row.slashed = slashed;
            pushFeed(row);
            flush();
          },
          jobRejected: (e) => {
            const provider = e.data.provider.toBase58();
            pushFeed(
              makeRow(e, "rejected", undefined, provider, e.data.refunded.toNumber(),
                `${nameOf(provider)} rejected the job · consumer refunded`,
                "REJECTED")
            );
            flush();
          },
          jobExpired: (e) => {
            const provider = e.data.provider.toBase58();
            const slashed = e.data.slashed.toNumber();
            const isSlash = slashed > 0;
            const prevSlashEvents = agentsMapRef.current.get(provider)?.slashEvents ?? 0;
            upsertAgent(provider, {
              scoreFailed: e.data.scoreFailed.toNumber(),
              ...(isSlash
                ? { slashEvents: prevSlashEvents + 1, lastSlashSlot: e.slot, justSlashed: Date.now() }
                : {}),
            });
            if (isSlash && liveRef.current) totalSlashedRef.current += slashed;
            const row = makeRow(
              e,
              isSlash ? "slash" : "expired",
              undefined,
              provider,
              e.data.refunded.toNumber(),
              isSlash
                ? `${nameOf(provider)} SLASHED · −${fmtUsdc(slashed)} USDC · delivery deadline missed`
                : `${nameOf(provider)} job expired · consumer refunded`,
              isSlash ? "SLASHED" : "EXPIRED"
            );
            if (isSlash) row.slashed = slashed;
            pushFeed(row);
            flush();
          },
          jobAbandoned: (e) => {
            const provider = e.data.provider.toBase58();
            const slashed = e.data.slashed.toNumber();
            const isSlash = slashed > 0;
            upsertAgent(provider, {
              scoreFailed: e.data.scoreFailed.toNumber(),
              slashEvents: e.data.slashEvents,
              ...(isSlash ? { lastSlashSlot: e.slot, justSlashed: Date.now() } : {}),
            });
            if (isSlash && liveRef.current) totalSlashedRef.current += slashed;
            const row = makeRow(
              e,
              isSlash ? "slash" : "abandoned",
              undefined,
              provider,
              e.data.refunded.toNumber(),
              isSlash
                ? `${nameOf(provider)} SLASHED · −${fmtUsdc(slashed)} USDC · job abandoned`
                : `${nameOf(provider)} abandoned the job`,
              isSlash ? "SLASHED" : "ABANDONED"
            );
            if (isSlash) row.slashed = slashed;
            pushFeed(row);
            flush();
          },
        };

        unsub = stream(program, handlers, {});
        unsub.ready.then(() => {
          if (cancelled) return;
          liveRef.current = true;
          flush();
        });
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setState((s) => ({ ...s, status: "error", error: message }));
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  return state;
}
