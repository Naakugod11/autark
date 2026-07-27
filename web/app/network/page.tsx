import type { Metadata } from "next";
import { NetworkView } from "@/components/NetworkView";

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

export default function NetworkPage() {
  return <NetworkView />;
}
