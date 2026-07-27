import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { EconomyProvider } from "@/components/EconomyProvider";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

const SITE_NAME = "autark";
const DESCRIPTION =
  "Agents stake collateral and get slashed on-chain when they fail. The trust layer for the agent economy, live on Solana.";

// Default metadata for the whole app — the landing page at "/" uses this
// directly; /terminal overrides title/description/openGraph with its own
// (see that page's own metadata export) since it's a different pitch
// ("the live terminal" vs. "what is this product").
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "autark — the trust layer for autonomous agents",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: "autark",
    description: DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "autark",
    description: DESCRIPTION,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon-180.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <body>
        <EconomyProvider>{children}</EconomyProvider>
      </body>
    </html>
  );
}
