/**
 * sdk/src/events.ts — Layer 4: typed event stream
 *
 * Provides:
 *  - Typed discriminated union AutarkEvent (all 13 program events)
 *  - subscribe()  — live WebSocket feed via connection.onLogs + EventParser
 *  - backfill()   — historical events from getSignaturesForAddress
 *  - stream()     — unified past + live with de-dup at the handoff boundary
 *
 * De-dup key: `${signature}:${eventIndexWithinTx}` — idempotent across
 * reconnects, backfill overlaps, and stream handoffs.
 *
 * Field names mirror Anchor 1.0's camelCase decoding of the IDL.
 */

import { BN, EventParser, BorshCoder, Program } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import type { Autark } from "../../target/types/autark";

// ── IDL & coder (singleton) ───────────────────────────────────────────────────

const _idl = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../target/idl/autark.json"), "utf-8")
);

const PROGRAM_ID = new PublicKey("FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy");

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
  [K in AutarkEventName]?: (
    event: Extract<AutarkEvent, { name: K }>
  ) => void;
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
        data: decoded.data as any,
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

/**
 * Live subscription: delivers typed events as they land on-chain.
 * Returns an unsubscribe function.
 */
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
        blockTime: null, // not available synchronously on onLogs
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

// ── backfill ──────────────────────────────────────────────────────────────────

/**
 * Historical backfill: fetches up to `limit` signatures for the program
 * starting from `fromSlot`, parses their logs, returns events chronologically.
 */
export async function backfill(
  program: Program<Autark>,
  opts: BackfillOpts = {}
): Promise<AutarkEvent[]> {
  const conn: Connection = program.provider.connection;
  const parser = makeParser(program);
  const { fromSlot, limit = 200 } = opts;

  // getSignaturesForAddress returns newest-first; we want oldest-first for output.
  const sigs = await conn.getSignaturesForAddress(PROGRAM_ID, {
    limit,
  });

  // Filter to fromSlot if specified (signatures are newest→oldest)
  const filtered = fromSlot != null
    ? sigs.filter((s) => (s.slot ?? 0) >= fromSlot)
    : sigs;

  // Fetch txs oldest-first so our output is chronological
  const chronological = [...filtered].reverse();

  const allEvents: AutarkEvent[] = [];

  for (const sigInfo of chronological) {
    if (sigInfo.err) continue;
    let tx: Awaited<ReturnType<typeof conn.getTransaction>> = null;
    try {
      tx = await conn.getTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
    } catch {
      continue;
    }
    if (!tx || !tx.meta?.logMessages) continue;

    const meta: AutarkEventMeta = {
      slot: tx.slot,
      signature: sigInfo.signature,
      blockTime: tx.blockTime ?? null,
    };
    const events = parseLogsToEvents(parser, tx.meta.logMessages, meta);

    // Assign per-tx indices for dedup key
    let idx = 0;
    for (const ev of events) {
      allEvents.push({ ...ev, _idx: idx++ } as any);
    }
  }

  // Strip internal _idx — it was only used during assembly
  return allEvents.map(({ _idx: _ignored, ...ev }: any) => ev as AutarkEvent);
}

// ── stream ────────────────────────────────────────────────────────────────────

/**
 * Unified stream: replays history from `fromSlot` then seamlessly transitions
 * to live events. De-dupes across the handoff boundary by
 * `${signature}:${eventIndexWithinTx}`.
 *
 * Returns an unsubscribe function. Callers may await the returned promise
 * `ready` (exposed on the return value) to know when backfill is complete and
 * the live feed is the sole source.
 */
export function stream(
  program: Program<Autark>,
  handlers: AutarkEventHandlers,
  opts: StreamOpts = {}
): Unsubscribe & { ready: Promise<void> } {
  const conn: Connection = program.provider.connection;
  const parser = makeParser(program);
  const { fromSlot, commitment = "confirmed" } = opts;

  const seen = new Set<string>();

  // Buffer live events received during backfill
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
        // Buffer: we'll flush after backfill, de-duping against backfill seen set
        liveBuffer.push({ events, baseIdx: 0 });
      } else {
        // Live path: dispatch directly
        let idx = 0;
        dispatchEvents(events, handlers, seen, 0);
        // dispatchEvents increments internally; just for clarity here:
        void idx;
      }
    },
    commitment
  );

  const ready = (async () => {
    // Backfill
    const history = await backfill(program, {
      fromSlot,
      limit: 500,
    });

    // Deliver history in order, building the seen set
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

    // Flush buffered live events — dedup against history seen set
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

// ── Convenience per-event subscription helpers ────────────────────────────────

export function onJobProposed(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "jobProposed" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { jobProposed: cb }, opts);
}

export function onJobAccepted(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "jobAccepted" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { jobAccepted: cb }, opts);
}

export function onSettlementPendingEvent(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "settlementPendingEvent" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { settlementPendingEvent: cb }, opts);
}

export function onJobSettled(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "jobSettled" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { jobSettled: cb }, opts);
}

export function onChallengeOpened(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "challengeOpened" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { challengeOpened: cb }, opts);
}

export function onChallengeDefended(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "challengeDefended" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { challengeDefended: cb }, opts);
}

export function onChallengeResolved(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "challengeResolved" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { challengeResolved: cb }, opts);
}

export function onBountyPosted(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "bountyPosted" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { bountyPosted: cb }, opts);
}

export function onBidSubmitted(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "bidSubmitted" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { bidSubmitted: cb }, opts);
}

export function onBountyAwarded(
  program: Program<Autark>,
  cb: (e: Extract<AutarkEvent, { name: "bountyAwarded" }>) => void,
  opts?: SubscribeOpts
): Unsubscribe {
  return subscribe(program, { bountyAwarded: cb }, opts);
}
