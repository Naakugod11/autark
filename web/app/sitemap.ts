import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { getProgram, fetchAgents } from "@/lib/autark";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// unstable_cache, not just `export const revalidate` — @solana/web3.js's RPC
// client is a plain fetch Next doesn't auto-cache (see the longer rationale
// in web/lib/agentProfile.ts). Without this, every crawl costs a fresh
// fetchAgents() RPC round-trip.
const getCachedAgents = unstable_cache(
  () => fetchAgents(getProgram()),
  ["sitemap-agents"],
  { revalidate: 3600 }
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "always", priority: 1 },
  ];

  try {
    const agents = await getCachedAgents();
    for (const a of agents) {
      entries.push({
        url: `${SITE_URL}/agent/${a.owner.toBase58()}`,
        changeFrequency: "hourly",
        priority: 0.6,
      });
    }
  } catch {
    // RPC unreachable at build/revalidate time — ship the sitemap with just
    // "/" rather than failing the whole route.
  }

  return entries;
}
