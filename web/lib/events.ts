/**
 * web/lib/events.ts — Browser-safe Autark event stream.
 *
 * Mirrors sdk/src/events.ts exactly (same de-dup keying, same stream/backfill/
 * subscribe shape) but drops the fs/path IDL load — the coder comes from the
 * Program instance passed in (already built from the JSON-imported IDL in
 * web/lib/autark.ts), so this never touches the SDK barrel (sdk/src/index.ts)
 * or Node-only globals.
 */

import type { Autark } from "../../target/types/autark";
import { EventParser, Program } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import type { BN } from "@anchor-lang/core";

const PROGRAM_ID = new PublicKey("FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy");

// Every public visitor triggers one full backfill (getSignaturesForAddress +
// N getTransaction calls) — these two constants are the RPC-load dial for a
// multi-visitor deploy. Lower = less load per page load, fewer 429s under
// concurrent traffic, but a shorter history window on first paint (the live
// feed still fills in from there; FEED_CAP in economy.ts keeps only the
// most recent 300 rows anyway, so backfilling far beyond that is largely
// wasted RPC spend). Tuned down from an earlier 500-signature/8-way-
// concurrent default that was sized for local single-visitor testing, not
// public traffic.
const STREAM_BACKFILL_LIMIT = 250;
const BACKFILL_CONCURRENCY = 5;

// ── Event payload types (camelCase — matches Anchor 1.0 decoded output) ───────

export type JobProposedData = {
  job: PublicKey;
  consumer: PublicKey;
  provider: PublicKey;
  amount: BN;
  mint: PublicKey;
  deliveryDeadline: BN;
};

export type JobAcceptedData = {
  job: PublicKey;
  provider: PublicKey;
  amount: BN;
  stakeLocked: BN;
  providerOpenJobs: number;
};

export type SettlementPendingEventData = {
  job: PublicKey;
  provider: PublicKey;
  settleEligibleAt: BN;
};

export type JobSettledData = {
  job: PublicKey;
  provider: PublicKey;
  amount: BN;
  scoreCompleted: BN;
  scoreVolume: BN;
  scoreFailed: BN;
};

export type BountyPostedData = {
  bounty: PublicKey;
  poster: PublicKey;
  capabilityRequired: string;
  maxAmount: BN;
  minReputation: number;
};

export type BidSubmittedData = {
  bounty: PublicKey;
  bidder: PublicKey;
  price: BN;
};

export type BountyAwardedData = {
  bounty: PublicKey;
  job: PublicKey;
  poster: PublicKey;
  provider: PublicKey;
  price: BN;
  refundToPoster: BN;
};

export type ChallengeOpenedData = {
  job: PublicKey;
  challenger: PublicKey;
  defender: PublicKey;
  amount: BN;
  defenseDeadline: BN;
};

export type ChallengeDefendedData = {
  job: PublicKey;
  defender: PublicKey;
  amount: BN;
};

export type ChallengeResolvedData = {
  job: PublicKey;
  defended: boolean;
  consumerRefund: BN;
  providerPayout: BN;
  slashed: BN;
  providerScoreCompleted: BN;
  providerScoreVolume: BN;
  providerScoreFailed: BN;
};

export type JobRejectedData = {
  job: PublicKey;
  provider: PublicKey;
  refunded: BN;
};

export type JobExpiredData = {
  job: PublicKey;
  provider: PublicKey;
  refunded: BN;
  slashed: BN;
  scoreFailed: BN;
};

export type JobAbandonedData = {
  job: PublicKey;
  provider: PublicKey;
  refunded: BN;
  slashed: BN;
  scoreFailed: BN;
  slashEvents: number;
};

// ── Discriminated union ───────────────────────────────────────────────────────

export type AutarkEventMeta = {
  slot: number;
  signature: string;
  blockTime: number | null;
};

export type AutarkEvent =
  | (AutarkEventMeta & { name: "jobProposed"; data: JobProposedData })
  | (AutarkEventMeta & { name: "jobAccepted"; data: JobAcceptedData })
  | (AutarkEventMeta & {
      name: "settlementPendingEvent";
      data: SettlementPendingEventData;
    })
  | (AutarkEventMeta & { name: "jobSettled"; data: JobSettledData })
  | (AutarkEventMeta & { name: "bountyPosted"; data: BountyPostedData })
  | (AutarkEventMeta & { name: "bidSubmitted"; data: BidSubmittedData })
  | (AutarkEventMeta & { name: "bountyAwarded"; data: BountyAwardedData })
  | (AutarkEventMeta & { name: "challengeOpened"; data: ChallengeOpenedData })
  | (AutarkEventMeta & { name: "challengeDefended"; data: ChallengeDefendedData })
  | (AutarkEventMeta & { name: "challengeResolved"; data: ChallengeResolvedData })
  | (AutarkEventMeta & { name: "jobRejected"; data: JobRejectedData })
  | (AutarkEventMeta & { name: "jobExpired"; data: JobExpiredData })
  | (AutarkEventMeta & { name: "jobAbandoned"; data: JobAbandonedData });

export type AutarkEventName = AutarkEvent["name"];

// ── Per-event handler map ─────────────────────────────────────────────────────

export type AutarkEventHandlers = {
  [K in AutarkEventName]?: (event: Extract<AutarkEvent, { name: K }>) => void;
};

// ── Options ───────────────────────────────────────────────────────────────────

export type SubscribeOpts = {
  commitment?: "confirmed" | "finalized";
};

export type BackfillOpts = {
  fromSlot?: number;
  limit?: number;
};

export type StreamOpts = {
  fromSlot?: number;
  commitment?: "confirmed" | "finalized";
};

export type Unsubscribe = () => void;

// ── Internal helpers ──────────────────────────────────────────────────────────

function makeParser(program: Program<Autark>): EventParser {
  return new EventParser(PROGRAM_ID, program.coder);
}

function parseLogsToEvents(
  parser: EventParser,
  logs: string[],
  meta: AutarkEventMeta
): AutarkEvent[] {
  const result: AutarkEvent[] = [];
  try {
    for (const decoded of parser.parseLogs(logs, false)) {
      result.push({
        ...meta,
        name: decoded.name as AutarkEventName,
        data: decoded.data as AutarkEvent["data"],
      } as AutarkEvent);
    }
  } catch {
    // Malformed logs — skip silently.
  }
  return result;
}

function dedupKey(signature: string, idx: number): string {
  return `${signature}:${idx}`;
}

function dispatchEvents(
  events: AutarkEvent[],
  handlers: AutarkEventHandlers,
  seen: Set<string>,
  startIdx = 0
): void {
  let idx = startIdx;
  for (const event of events) {
    const key = dedupKey(event.signature, idx++);
    if (seen.has(key)) continue;
    seen.add(key);
    const cb = handlers[event.name] as ((e: AutarkEvent) => void) | undefined;
    cb?.(event);
  }
}

// ── subscribe ─────────────────────────────────────────────────────────────────

export function subscribe(
  program: Program<Autark>,
  handlers: AutarkEventHandlers,
  opts: SubscribeOpts = {}
): Unsubscribe {
  const conn: Connection = program.provider.connection;
  const parser = makeParser(program);
  const seen = new Set<string>();
  const commitment = opts.commitment ?? "confirmed";

  const subId = conn.onLogs(
    PROGRAM_ID,
    (logResult, ctx) => {
      if (logResult.err) return;
      const meta: AutarkEventMeta = {
        slot: ctx.slot,
        signature: logResult.signature,
        blockTime: null,
      };
      const events = parseLogsToEvents(parser, logResult.logs, meta);
      dispatchEvents(events, handlers, seen);
    },
    commitment
  );

  return () => {
    conn.removeOnLogsListener(subId);
  };
}

// Bounded-concurrency map — getTransaction calls are independent reads, so
// fetching them in parallel (capped, to stay polite to the RPC) cuts a
// 184-signature backfill from ~75s to a few seconds. Order of `results`
// matches `items`, so callers can still assemble chronologically.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

// 429 handling: @solana/web3.js's Connection retries HTTP 429s internally —
// bounded (5 attempts) with exponential backoff (500ms, doubling, capped by
// attempt count rather than a time ceiling). That's deliberate library
// behavior, not something this code adds on top of: we never re-issue a
// getTransaction call ourselves, so a rate-limited backfill just takes
// longer per call rather than multiplying request volume. The UI reflects
// this correctly — status stays "backfilling" (SYNCING HISTORY) for the
// whole await, with no extra polling/hammering from our side. The one
// knob we do control is concurrency (BACKFILL_CONCURRENCY above): fewer
// simultaneous in-flight requests means a smaller burst against Helius's
// per-second limit, at the cost of a slower backfill wall-clock time.

// ── backfill ──────────────────────────────────────────────────────────────────

export async function backfill(
  program: Program<Autark>,
  opts: BackfillOpts = {}
): Promise<AutarkEvent[]> {
  const conn: Connection = program.provider.connection;
  const parser = makeParser(program);
  const { fromSlot, limit = 200 } = opts;

  const sigs = await conn.getSignaturesForAddress(PROGRAM_ID, { limit });

  const filtered =
    fromSlot != null ? sigs.filter((s) => (s.slot ?? 0) >= fromSlot) : sigs;

  const chronological = [...filtered].reverse().filter((s) => !s.err);

  const txs = await mapWithConcurrency(chronological, BACKFILL_CONCURRENCY, (sigInfo) =>
    conn
      .getTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .catch(() => null)
  );

  const allEvents: AutarkEvent[] = [];
  for (let i = 0; i < chronological.length; i++) {
    const tx = txs[i];
    if (!tx || !tx.meta?.logMessages) continue;

    const meta: AutarkEventMeta = {
      slot: tx.slot,
      signature: chronological[i].signature,
      blockTime: tx.blockTime ?? null,
    };
    const events = parseLogsToEvents(parser, tx.meta.logMessages, meta);
    allEvents.push(...events);
  }

  return allEvents;
}

// ── stream ────────────────────────────────────────────────────────────────────

export function stream(
  program: Program<Autark>,
  handlers: AutarkEventHandlers,
  opts: StreamOpts = {}
): Unsubscribe & { ready: Promise<void> } {
  const conn: Connection = program.provider.connection;
  const parser = makeParser(program);
  const { fromSlot, commitment = "confirmed" } = opts;

  const seen = new Set<string>();

  const liveBuffer: Array<{ events: AutarkEvent[]; baseIdx: number }> = [];
  let backfillDone = false;

  const subId = conn.onLogs(
    PROGRAM_ID,
    (logResult, ctx) => {
      if (logResult.err) return;
      const meta: AutarkEventMeta = {
        slot: ctx.slot,
        signature: logResult.signature,
        blockTime: null,
      };
      const events = parseLogsToEvents(parser, logResult.logs, meta);
      if (!events.length) return;

      if (!backfillDone) {
        liveBuffer.push({ events, baseIdx: 0 });
      } else {
        dispatchEvents(events, handlers, seen, 0);
      }
    },
    commitment
  );

  const ready = (async () => {
    const history = await backfill(program, { fromSlot, limit: STREAM_BACKFILL_LIMIT });

    let histIdx = 0;
    for (const ev of history) {
      const key = dedupKey(ev.signature, histIdx);
      if (!seen.has(key)) {
        seen.add(key);
        const cb = handlers[ev.name] as ((e: AutarkEvent) => void) | undefined;
        cb?.(ev);
      }
      histIdx++;
    }

    for (const { events } of liveBuffer) {
      dispatchEvents(events, handlers, seen, 0);
    }
    liveBuffer.length = 0;
    backfillDone = true;
  })();

  const unsub: Unsubscribe & { ready: Promise<void> } = Object.assign(
    () => {
      conn.removeOnLogsListener(subId);
    },
    { ready }
  );

  return unsub;
}
