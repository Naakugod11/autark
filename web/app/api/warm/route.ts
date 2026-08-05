/**
 * web/app/api/warm/route.ts — cron-hit keepalive endpoint (see
 * .github/workflows/keepalive.yml). Every serverless lambda here is cold by
 * default at this traffic level (unstable_cache is per-instance, so a cold
 * lambda means a cold cache too); this route exists purely to be pinged on a
 * schedule so a visitor is less likely to be the one paying for the cold
 * chain read.
 *
 * Calls the exact same cached accessors the pages use (web/lib/chainCache.ts)
 * — no separate RPC path, so it shares the same throttle/single-flight/TTL
 * behavior everything else does instead of adding its own budget.
 */

import { NextResponse } from "next/server";
import { getAgentsSnapshot, getEventRows } from "@/lib/chainCache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = request.headers.get("x-warm-key");
  if (!key || key !== process.env.WARM_CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  try {
    const [{ agents }, { rows }] = await Promise.all([getAgentsSnapshot(), getEventRows()]);
    return NextResponse.json({ ok: true, agents: agents.length, events: rows.length, ms: Date.now() - started });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const maxDuration = 60;
