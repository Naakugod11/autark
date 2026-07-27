import type { MetadataRoute } from "next";
import { getAgentsSnapshot } from "@/lib/chainCache";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Forces this route to render at request time instead of `next build`
// attempting to prerender it — a build has no live chain state to sitemap,
// and prerendering was one of the sources of the build-time RPC storm (see
// web/lib/chainCache.ts). Uses getAgentsSnapshot(), not getEventRows() — a
// sitemap only needs the agent list, never the (much more expensive)
// event backfill.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "always", priority: 1 },
    { url: `${SITE_URL}/terminal`, changeFrequency: "always", priority: 0.9 },
  ];

  try {
    const { agents } = await getAgentsSnapshot();
    for (const a of agents) {
      entries.push({
        url: `${SITE_URL}/agent/${a.owner}`,
        changeFrequency: "hourly",
        priority: 0.6,
      });
    }
  } catch {
    // RPC unreachable — ship the sitemap with just "/" rather than failing
    // the whole route.
  }

  return entries;
}
