/**
 * web/app/api/identity-overrides/route.ts — the client-side read path for
 * Task 4's upload manifest. The client economy store (web/lib/economy.ts)
 * fetches this once on init and layers it over identityFor() via
 * resolveIdentity(), the same composition server components get from
 * web/lib/identityOverrides.ts directly. Two read paths, same underlying
 * store (web/lib/pfpStore.ts) — this route exists because a browser can't
 * import a Node fs/Blob-backed module directly.
 */

import { NextResponse } from "next/server";
import { getIdentityOverrides } from "@/lib/identityOverrides";

export const dynamic = "force-dynamic";

export async function GET() {
  const overrides = await getIdentityOverrides();
  return NextResponse.json(overrides);
}
