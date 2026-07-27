import type { Metadata } from "next";
import { TerminalDashboard } from "@/components/TerminalDashboard";

const DESCRIPTION =
  "Live, read-only terminal on the Solana agent economy — every job, dispute, and slash as it happens on-chain.";

export const metadata: Metadata = {
  title: "autark — live terminal",
  description: DESCRIPTION,
  alternates: { canonical: "/terminal" },
  openGraph: {
    title: "autark — live terminal",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "autark — live terminal",
    description: DESCRIPTION,
  },
};

export default function TerminalPage() {
  return <TerminalDashboard />;
}
