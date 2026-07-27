/**
 * web/lib/badges.ts — badge derivation, pure and dependency-light on
 * purpose: this module prefigures the paid reputation API (the free
 * dashboard is top-of-funnel for it), so its shape needs to stay clean
 * enough to lift into that product mostly as-is.
 *
 * THE WALL (absolute, read before touching this file):
 *
 *   - Reputation badges are derived ONLY from ungameable on-chain facts —
 *     lifetime settled volume, a genuinely clean lifetime slash record, and
 *     surviving a challenge. These are the credentials the future
 *     reputation API sells; they must never be influenced by anything an
 *     agent's owner can freely fake (a display name, an upload, activity
 *     recency, being early).
 *   - Vanity/activity badges are UI flair — early registrant, active
 *     today, has bid on a bounty. They exist to make the dashboard feel
 *     alive, nothing more.
 *
 * The two are returned as separate arrays (deriveReputationBadges /
 * deriveVanityBadges), never merged into one list by this module. Every
 * surface that renders badges (profile, fleet card, leaderboard, OG image)
 * MUST keep them visually distinct and MUST NOT feed vanity badges into
 * any ranking/trust computation — see each render site for the "never
 * blended" treatment.
 *
 * A note on "clean record" vs. Task 2's gamification streak
 * (web/lib/streaks.ts): those are deliberately DIFFERENT metrics computed
 * differently on purpose. streaks.ts counts the CURRENT run since the last
 * slash (bragging rights that reset — a slashed agent can rebuild one).
 * The reputation badge below is a LIFETIME credential: once slashEvents is
 * nonzero, this agent can never earn a "clean record" reputation badge
 * again, no matter how long its current streak gets. A resettable stat and
 * a permanent credential must not be the same number, or the "credential"
 * stops meaning anything.
 */

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum";

export type ReputationBadge = {
  id: string;
  category: "reputation";
  label: string;
  tier: BadgeTier;
  description: string;
};

export type VanityBadge = {
  id: string;
  category: "vanity";
  label: string;
  description: string;
};

export type Badge = ReputationBadge | VanityBadge;

// ── Reputation ────────────────────────────────────────────────────────────

export type ReputationInput = {
  /** Lifetime settled volume, micro-USDC (Agent.scoreVolume on-chain). */
  scoreVolume: number;
  /** Lifetime completed jobs (Agent.scoreCompleted on-chain). */
  scoreCompleted: number;
  /** Lifetime slash count (Agent.slashEvents on-chain) — zero forever, or not. */
  slashEvents: number;
  /**
   * Lifetime count of challenges resolved in this agent's favor as
   * defender — derived from event history (challengeResolved with
   * defended=true, or a standalone challengeDefended), NOT part of the
   * Agent account itself, so callers must aggregate it from the shared
   * event feed/rows before calling this.
   */
  challengesDefended: number;
};

// Tuned to this deployment's actual test-USDC scale (the demo arc moves ~1
// USDC per job) so the tiers are reachable and demonstrable on devnet, not
// theoretical thresholds sized for a mainnet economy that doesn't exist yet.
const VOLUME_TIERS: { tier: BadgeTier; minMicro: number }[] = [
  { tier: "platinum", minMicro: 500_000_000 }, // $500+
  { tier: "gold", minMicro: 100_000_000 }, // $100+
  { tier: "silver", minMicro: 25_000_000 }, // $25+
  { tier: "bronze", minMicro: 5_000_000 }, // $5+
];

const CLEAN_RECORD_TIERS: { tier: BadgeTier; minCompleted: number }[] = [
  { tier: "platinum", minCompleted: 50 },
  { tier: "gold", minCompleted: 20 },
  { tier: "silver", minCompleted: 10 },
  { tier: "bronze", minCompleted: 3 },
];

const SURVIVOR_TIERS: { tier: BadgeTier; minDefended: number }[] = [
  { tier: "gold", minDefended: 5 },
  { tier: "silver", minDefended: 2 },
  { tier: "bronze", minDefended: 1 },
];

function fmtUsd(micro: number): string {
  return `$${(micro / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const TIER_RANK: Record<BadgeTier, number> = { platinum: 4, gold: 3, silver: 2, bronze: 1 };

// Highest tier across a set of reputation badges — used by compact surfaces
// (the leaderboard) that show one credential indicator per agent rather
// than the full badge row a profile or fleet card has room for.
export function bestTier(badges: ReputationBadge[]): BadgeTier | null {
  let best: BadgeTier | null = null;
  for (const b of badges) {
    if (!best || TIER_RANK[b.tier] > TIER_RANK[best]) best = b.tier;
  }
  return best;
}

export function deriveReputationBadges(input: ReputationInput): ReputationBadge[] {
  const badges: ReputationBadge[] = [];

  const volumeTier = VOLUME_TIERS.find((t) => input.scoreVolume >= t.minMicro);
  if (volumeTier) {
    badges.push({
      id: "volume",
      category: "reputation",
      label: `${volumeTier.tier.toUpperCase()} VOLUME`,
      tier: volumeTier.tier,
      description: `Settled ${fmtUsd(input.scoreVolume)}+ lifetime — on-chain, verifiable.`,
    });
  }

  // Ungameable by construction: any lifetime slash disqualifies this badge
  // permanently, regardless of current completed count or how long ago the
  // slash was.
  if (input.slashEvents === 0) {
    const cleanTier = CLEAN_RECORD_TIERS.find((t) => input.scoreCompleted >= t.minCompleted);
    if (cleanTier) {
      badges.push({
        id: "clean-record",
        category: "reputation",
        label: `${cleanTier.tier.toUpperCase()} CLEAN RECORD`,
        tier: cleanTier.tier,
        description: `${input.scoreCompleted} completed jobs, zero slashes, ever.`,
      });
    }
  }

  const survivorTier = SURVIVOR_TIERS.find((t) => input.challengesDefended >= t.minDefended);
  if (survivorTier) {
    badges.push({
      id: "dispute-survivor",
      category: "reputation",
      label: "DISPUTE SURVIVOR",
      tier: survivorTier.tier,
      description: `Successfully defended ${input.challengesDefended} challenge${input.challengesDefended === 1 ? "" : "s"} on-chain.`,
    });
  }

  return badges;
}

// ── Vanity / activity ──────────────────────────────────────────────────────

export type VanityInput = {
  /** 1-based rank by on-chain registration time among ALL registered agents. */
  registrationRank: number;
  /** ms epoch of the most recent event involving this agent, or null. */
  lastActivityTs: number | null;
  /** Has this agent ever submitted a bounty bid (bidSubmitted, as bidder). */
  hasBidOnBounty: boolean;
};

const EARLY_REGISTRANT_CUTOFF = 10;
const ACTIVE_TODAY_MS = 24 * 60 * 60 * 1000;

export function deriveVanityBadges(input: VanityInput, now: number = Date.now()): VanityBadge[] {
  const badges: VanityBadge[] = [];

  if (input.registrationRank > 0 && input.registrationRank <= EARLY_REGISTRANT_CUTOFF) {
    badges.push({
      id: "early-registrant",
      category: "vanity",
      label: "EARLY REGISTRANT",
      description: `#${input.registrationRank} agent ever registered on autark.`,
    });
  }

  if (input.lastActivityTs != null && now - input.lastActivityTs <= ACTIVE_TODAY_MS) {
    badges.push({
      id: "active-today",
      category: "vanity",
      label: "ACTIVE TODAY",
      description: "Had on-chain activity in the last 24 hours.",
    });
  }

  if (input.hasBidOnBounty) {
    badges.push({
      id: "bounty-bidder",
      category: "vanity",
      label: "BOUNTY BIDDER",
      description: "Has bid on an open bounty.",
    });
  }

  return badges;
}
