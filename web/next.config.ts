import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // web/ is a subdirectory of a larger (Anchor/Rust) monorepo, and
  // web/lib/autark.ts + events.ts import ../../target/idl/autark.json and
  // ../../target/types/autark.ts — outside web/. Next.js's build/deploy
  // tracing defaults to treating web/ itself as the trace root (it's where
  // next.config.ts lives), which would exclude those two directories up
  // files from the traced output. This is exactly the monorepo case Next's
  // own docs call out for outputFileTracingRoot: without it, this works
  // fine in dev but can silently misbehave in a Vercel/standalone
  // production build. Point it at the actual repo root (one level up).
  outputFileTracingRoot: path.join(__dirname, ".."),

  // Turbopack (default in Next 16) — no extra config needed for Solana packages
  turbopack: {},

  // Keep webpack config for `next build --webpack` fallback
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        os: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
