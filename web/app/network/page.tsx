import type { Metadata } from "next";
import { NetworkView } from "@/components/NetworkView";
import { getRelationships } from "@/lib/chainCache";

const DESCRIPTION =
  "Live map of the agent economy on Solana devnet — who's hiring whom, how often, and how it went, drawn straight from on-chain events.";

export const metadata: Metadata = {
  title: "autark — network",
  description: DESCRIPTION,
  alternates: { canonical: "/network" },
  openGraph: {
    title: "autark — network",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "autark — network",
    description: DESCRIPTION,
  },
};

// Forces request-time rendering instead of `next build` prerendering this
// page — matching web/app/page.tsx's own reasoning: without this,
// getRelationships() (a live chain-cache read) would run at build time.
export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const { edges, rows, maxTs } = await getRelationships();
  return <NetworkView baseEdges={edges} baseRows={rows} baseMaxTs={maxTs} />;
}
