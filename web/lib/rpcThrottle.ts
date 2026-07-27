/**
 * web/lib/rpcThrottle.ts — one global RPC gate, shared by every Connection
 * this process creates.
 *
 * Root cause of the 429 storms: web/lib/autark.ts's getConnection() and
 * web/lib/demoArc.ts's signingProgram() each build a fresh Connection per
 * call, and @solana/web3.js issues its own HTTP request per RPC method with
 * no cross-Connection awareness of how many other Connections (server
 * cache warm, client terminal backfill, other visitors' browser tabs, the
 * demo route's status poll) are hitting the same Helius key at the same
 * moment. Passing a shared `fetch` override into every Connection turns
 * that into ONE gate per process (one per serverless instance, one per
 * browser tab) instead of zero.
 *
 * Two independent mechanisms, both required:
 *
 *   1. Rate limiting — every dispatch waits for its turn on a single
 *      evenly-spaced schedule (1000/rps ms apart), enforced by chaining
 *      onto one module-level promise so concurrent callers queue instead
 *      of racing. Even spacing (vs. "N per rolling window then burst") is
 *      deliberately friendlier to Helius's own per-second limiter than a
 *      bucket that dumps `rps` requests at once and then goes idle.
 *
 *   2. Single-flight dedupe — if the exact same JSON-RPC call (method +
 *      params, ignoring the `id` field, which free-tier callers increment
 *      per call) is already in flight, later callers await and clone that
 *      one Response instead of issuing a second request. This is what
 *      protects against N concurrent visitors' server-rendered pages (or
 *      the client backfill re-running per browser tab) asking for the same
 *      account/signature data inside the same instant.
 *
 * Env-configurable so a paid-tier deploy can raise the ceiling without a
 * code change: NEXT_PUBLIC_RPC_RPS_BUDGET (read by both browser and server
 * bundles) falling back to RPC_RPS_BUDGET (server-only convenience), then a
 * conservative free-tier default.
 */

// Measured against the actual configured free-tier Helius devnet key: a
// cold ~150-dispatch snapshot warm at 8 rps still produced occasional
// scattered 429s (roughly 1 in 12 requests); the same warm at 5 rps
// produced zero over multiple repeated cold runs. 5 is the default for
// that reason, not a guess.
const DEFAULT_RPS = 5;

function budget(): number {
  const raw =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_RPC_RPS_BUDGET || process.env.RPC_RPS_BUDGET)) ||
    undefined;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RPS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Even-spaced scheduler ─────────────────────────────────────────────────
// Chaining onto `chain` serializes the "compute my slot" step itself, so
// concurrent callers reserve consecutive slots rather than all reading
// `lastDispatch` before any of them updates it.

let chain: Promise<void> = Promise.resolve();
let lastDispatch = 0;

// `weight` lets one dispatch account for more than one budgeted request —
// used by events.ts's JSON-RPC batch getTransaction calls, where a single
// HTTP POST bundles N sub-calls that Helius bills/rate-limits as N requests,
// not one. A weight-1 caller (the common case — every plain Connection RPC
// call) still gets exactly 1/rps seconds of spacing.
function reserveSlots(weight: number): Promise<void> {
  const minGapMs = 1000 / budget();
  const reserved = chain.then(async () => {
    const wait = lastDispatch + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastDispatch = Math.max(Date.now(), lastDispatch + minGapMs * weight);
  });
  // Detach from `chain` so one rejected slot (there shouldn't be any — this
  // step never throws) can't wedge every future reservation.
  chain = reserved.catch(() => {});
  return reserved;
}

// ── Single-flight dedupe ──────────────────────────────────────────────────
// Keyed on url + JSON-RPC method/params (the `id` field is deliberately
// excluded — it's a per-call correlation number, not part of what makes two
// requests "the same read").

const inflight = new Map<string, Promise<Response>>();

function dedupeKey(url: string, init: RequestInit | undefined): string | null {
  const rawBody = init?.body;
  if (typeof rawBody !== "string") return null;
  try {
    const parsed = JSON.parse(rawBody);
    if (Array.isArray(parsed)) return null; // batch requests: not deduped, each is already distinct work
    if (!parsed || typeof parsed !== "object" || !("method" in parsed)) return null;
    return `${url}::${parsed.method}::${JSON.stringify(parsed.params ?? null)}`;
  } catch {
    return null;
  }
}

async function dedupedDispatch(
  url: string,
  init: RequestInit | undefined,
  doFetch: () => Promise<Response>
): Promise<Response> {
  const key = dedupeKey(url, init);
  if (!key) return doFetch();

  const existing = inflight.get(key);
  if (existing) return (await existing).clone();

  const p = doFetch();
  inflight.set(key, p);
  try {
    return (await p).clone();
  } finally {
    // Only clear if we're still the entry that put it there — a slower
    // duplicate that arrived and got queued behind us must not delete a
    // newer in-flight entry it never owned.
    if (inflight.get(key) === p) inflight.delete(key);
  }
}

/**
 * Drop-in replacement for the global `fetch`, passed as the `fetch` option
 * to every `new Connection(...)` in this codebase (see web/lib/autark.ts
 * and web/lib/demoArc.ts). Safe to share across every Connection instance —
 * all the state above is module-level, so it's one gate per process
 * regardless of how many Connections get constructed.
 */
export function throttledFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  return reserveSlots(1).then(() => dedupedDispatch(url, init, () => fetch(input, init)));
}

/**
 * Lower-level primitive for callers that issue their own raw JSON-RPC POST
 * outside a Connection instance (events.ts's batched getTransaction calls —
 * see its header comment) but still need to sit behind the same shared
 * pacing. `weight` should be the number of RPC sub-calls the caller is about
 * to make in one HTTP request, so a 10-signature batch paces itself as 10
 * budgeted requests, not 1.
 */
export function reserveRpcSlots(weight: number): Promise<void> {
  return reserveSlots(weight);
}
