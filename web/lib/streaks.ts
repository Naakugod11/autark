/**
 * web/lib/streaks.ts — consecutive clean-settle streak per provider, derived
 * from the same feed every other surface reads (web/lib/economy.ts).
 *
 * "Clean settle streak" counts consecutive `jobSettled`/defended-challenge
 * outcomes for a provider, walking back from the newest event, stopping the
 * count the moment a `slash` row for that provider is hit — per the product
 * spec, a streak breaks ONLY on slash, not on every failure family (an
 * expired/abandoned/rejected job that happened not to trigger a slash — e.g.
 * zero stake at risk — still counts against scoreFailed elsewhere, but
 * deliberately doesn't zero this particular bragging-rights counter). Any
 * other in-flight state (proposed/accepted/pending/open dispute) is simply
 * not an outcome yet, so it's skipped rather than breaking or extending the
 * streak.
 */

import type { FeedRow } from "./economy";

export function computeStreaks(feed: FeedRow[]): Map<string, number> {
  const streaks = new Map<string, number>();
  const broken = new Set<string>();

  // feed is newest-first — walking it in that order and stopping at the
  // first slash per provider is exactly "count back from now until the last
  // time this agent got slashed."
  for (const row of feed) {
    const provider = row.provider;
    if (!provider || broken.has(provider)) continue;

    if (row.state === "settled") {
      streaks.set(provider, (streaks.get(provider) ?? 0) + 1);
    } else if (row.state === "slash") {
      broken.add(provider);
      if (!streaks.has(provider)) streaks.set(provider, 0);
    }
  }

  return streaks;
}
