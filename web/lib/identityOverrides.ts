/**
 * web/lib/identityOverrides.ts — server-side cached read of the PFP/name
 * upload manifest (web/lib/pfpStore.ts), for server components that want
 * to apply Task 4's upload identity tier (profile page, OG image).
 *
 * Short revalidate window (uploads are rare and low-stakes to show a
 * moment stale) — deliberately its own cache, independent of
 * web/lib/chainCache.ts's on-chain snapshot, since this reads the PFP
 * store, not Solana RPC.
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getPfpStore } from "./pfpStore";
import type { IdentityOverridesManifest } from "./identity";

export const OVERRIDES_REVALIDATE_SECONDS = 30;

async function loadOverridesManifest(): Promise<IdentityOverridesManifest> {
  return getPfpStore().readManifest();
}

export const getIdentityOverrides = cache(
  unstable_cache(loadOverridesManifest, ["identity-overrides-manifest"], {
    revalidate: OVERRIDES_REVALIDATE_SECONDS,
  })
);
