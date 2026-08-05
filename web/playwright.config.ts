import { defineConfig, devices } from "@playwright/test";

// web/playwright.config.ts — Task 2/proof: headless checks that pan/zoom/
// drag interaction actually wires up on the network graph, and that the
// dashboard holds at a 390px mobile viewport (no horizontal overflow).
// Points at `next start` against a production build (not `next dev`) so
// these checks run against the same bundle that ships — see package.json's
// `test:e2e` script for the build+start it expects to already be running.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  // Serialized on purpose: every test here shares one rate-limited devnet
  // RPC key (see web/lib/rpcThrottle.ts's own throttle-budget reasoning).
  // That throttle is per-browser-context, not process-global — running
  // multiple Playwright workers means multiple isolated browser contexts,
  // each independently backfilling ~150 events against the SAME key at the
  // same time, well past what one real visitor's tab would ever send.
  // Empirically reproduced a 429 storm severe enough to segfault the local
  // `next start` under 4 parallel workers — one worker keeps this suite
  // inside the same real-world RPC budget the rest of this app respects.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    // This sandboxed dev environment needs --no-sandbox or Chromium's
    // network service intermittently suspends outbound requests entirely
    // (reproduced directly: default launch args -> RPC calls never fire at
    // all). Harmless outside a sandbox — Chromium just uses its own.
    launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
  },
  // Each spec is routed to exactly one project (rather than every spec
  // running under every project + a runtime testInfo.project skip) so a
  // project that has nothing to run for a file never pays for that file's
  // setup (namely network-interaction.spec.ts's one shared devnet backfill —
  // see that file's own comment on why it's shared across its tests).
  projects: [
    { name: "desktop", testMatch: /network-interaction\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-390",
      testMatch: /mobile-viewport\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 }, userAgent: devices["iPhone 13"].userAgent, hasTouch: true },
    },
  ],
});
