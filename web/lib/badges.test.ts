import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveReputationBadges, deriveVanityBadges, bestTier, type ReputationInput, type VanityInput } from "./badges";
import {
  countChallengesDefended,
  hasBidOnBounty,
  lastActivityTs,
  computeRegistrationRanks,
} from "./badgeInputs";
import type { FeedRow } from "./economy";

function repInput(overrides: Partial<ReputationInput> = {}): ReputationInput {
  return {
    scoreVolume: 0,
    scoreCompleted: 0,
    slashEvents: 0,
    challengesDefended: 0,
    ...overrides,
  };
}

describe("deriveReputationBadges — volume tiers", () => {
  test("no badge below the bronze threshold", () => {
    const badges = deriveReputationBadges(repInput({ scoreVolume: 4_999_999 }));
    assert.equal(badges.find((b) => b.id === "volume"), undefined);
  });

  test("awards exactly one volume badge at the highest tier reached", () => {
    const badges = deriveReputationBadges(repInput({ scoreVolume: 500_000_000 }));
    const volumeBadges = badges.filter((b) => b.id === "volume");
    assert.equal(volumeBadges.length, 1);
    assert.equal(volumeBadges[0].tier, "platinum");
  });

  test("bronze/silver/gold thresholds are ordered correctly", () => {
    assert.equal(deriveReputationBadges(repInput({ scoreVolume: 5_000_000 }))[0]?.tier, "bronze");
    assert.equal(deriveReputationBadges(repInput({ scoreVolume: 25_000_000 }))[0]?.tier, "silver");
    assert.equal(deriveReputationBadges(repInput({ scoreVolume: 100_000_000 }))[0]?.tier, "gold");
  });
});

describe("deriveReputationBadges — clean record (THE WALL: must be ungameable)", () => {
  test("no badge with zero completed jobs", () => {
    const badges = deriveReputationBadges(repInput({ scoreCompleted: 0, slashEvents: 0 }));
    assert.equal(badges.find((b) => b.id === "clean-record"), undefined);
  });

  test("awards a tier once the completed threshold is crossed with zero slashes", () => {
    const badges = deriveReputationBadges(repInput({ scoreCompleted: 3, slashEvents: 0 }));
    const clean = badges.find((b) => b.id === "clean-record");
    assert.ok(clean);
    assert.equal(clean.tier, "bronze");
  });

  test("even a single lifetime slash permanently forfeits the badge, no matter how much volume follows", () => {
    const badges = deriveReputationBadges(repInput({ scoreCompleted: 500, slashEvents: 1 }));
    assert.equal(badges.find((b) => b.id === "clean-record"), undefined);
  });
});

describe("deriveReputationBadges — dispute survivor", () => {
  test("no badge with zero defended challenges", () => {
    const badges = deriveReputationBadges(repInput({ challengesDefended: 0 }));
    assert.equal(badges.find((b) => b.id === "dispute-survivor"), undefined);
  });

  test("tiers up with more successful defenses", () => {
    assert.equal(deriveReputationBadges(repInput({ challengesDefended: 1 }))[0]?.tier, "bronze");
    assert.equal(deriveReputationBadges(repInput({ challengesDefended: 2 }))[0]?.tier, "silver");
    assert.equal(deriveReputationBadges(repInput({ challengesDefended: 5 }))[0]?.tier, "gold");
  });
});

describe("bestTier", () => {
  test("null for an empty badge list", () => {
    assert.equal(bestTier([]), null);
  });

  test("picks the highest tier across mixed badges", () => {
    const badges = deriveReputationBadges(repInput({ scoreVolume: 5_000_000, scoreCompleted: 50, slashEvents: 0, challengesDefended: 5 }));
    // volume=bronze, clean-record=platinum, dispute-survivor=gold — best should be platinum
    assert.equal(bestTier(badges), "platinum");
  });
});

describe("THE WALL — reputation vs. vanity never mix", () => {
  test("every reputation badge is tagged category 'reputation'", () => {
    const badges = deriveReputationBadges(
      repInput({ scoreVolume: 500_000_000, scoreCompleted: 50, challengesDefended: 5 })
    );
    assert.ok(badges.length > 0);
    for (const b of badges) assert.equal(b.category, "reputation");
  });

  test("every vanity badge is tagged category 'vanity'", () => {
    const badges = deriveVanityBadges(
      { registrationRank: 1, lastActivityTs: Date.now(), hasBidOnBounty: true },
      Date.now()
    );
    assert.ok(badges.length > 0);
    for (const b of badges) assert.equal(b.category, "vanity");
  });

  test("reputation and vanity badge id namespaces never collide", () => {
    const repIds = new Set(
      deriveReputationBadges(repInput({ scoreVolume: 500_000_000, scoreCompleted: 50, challengesDefended: 5 })).map(
        (b) => b.id
      )
    );
    const vanityIds = new Set(
      deriveVanityBadges({ registrationRank: 1, lastActivityTs: Date.now(), hasBidOnBounty: true }, Date.now()).map(
        (b) => b.id
      )
    );
    for (const id of vanityIds) assert.ok(!repIds.has(id), `id "${id}" appears in both categories`);
  });
});

describe("deriveVanityBadges", () => {
  const now = 1_700_000_000_000;

  function vanInput(overrides: Partial<VanityInput> = {}): VanityInput {
    return { registrationRank: 999, lastActivityTs: null, hasBidOnBounty: false, ...overrides };
  }

  test("early registrant only within the top-10 cutoff", () => {
    assert.ok(deriveVanityBadges(vanInput({ registrationRank: 1 }), now).some((b) => b.id === "early-registrant"));
    assert.ok(deriveVanityBadges(vanInput({ registrationRank: 10 }), now).some((b) => b.id === "early-registrant"));
    assert.ok(!deriveVanityBadges(vanInput({ registrationRank: 11 }), now).some((b) => b.id === "early-registrant"));
  });

  test("active today only within a rolling 24h window", () => {
    const within = now - 60 * 60 * 1000; // 1h ago
    const outside = now - 25 * 60 * 60 * 1000; // 25h ago
    assert.ok(deriveVanityBadges(vanInput({ lastActivityTs: within }), now).some((b) => b.id === "active-today"));
    assert.ok(!deriveVanityBadges(vanInput({ lastActivityTs: outside }), now).some((b) => b.id === "active-today"));
    assert.ok(!deriveVanityBadges(vanInput({ lastActivityTs: null }), now).some((b) => b.id === "active-today"));
  });

  test("bounty bidder passes through directly", () => {
    assert.ok(deriveVanityBadges(vanInput({ hasBidOnBounty: true }), now).some((b) => b.id === "bounty-bidder"));
    assert.ok(!deriveVanityBadges(vanInput({ hasBidOnBounty: false }), now).some((b) => b.id === "bounty-bidder"));
  });
});

// ── badgeInputs.ts aggregation helpers ──────────────────────────────────────

const OWNER = "OWNER11111111111111111111111111111111111111";
const OTHER = "OTHER11111111111111111111111111111111111111";

function row(overrides: Partial<FeedRow>): FeedRow {
  return {
    id: "id",
    slot: 1,
    signature: "sig",
    ts: 1000,
    kind: "jobSettled",
    state: "settled",
    headline: "",
    badge: "",
    ...overrides,
  };
}

describe("badgeInputs — countChallengesDefended", () => {
  test("counts only challengeDefended rows for this owner as provider", () => {
    const feed: FeedRow[] = [
      row({ kind: "challengeDefended", state: "defended", provider: OWNER }),
      // A challengeResolved(defended=true) row for the SAME dispute — must
      // NOT double-count it.
      row({ kind: "challengeResolved", state: "defended", provider: OWNER }),
      row({ kind: "challengeDefended", state: "defended", provider: OTHER }),
    ];
    assert.equal(countChallengesDefended(feed, OWNER), 1);
  });
});

describe("badgeInputs — hasBidOnBounty", () => {
  test("true only when this owner appears as bidder", () => {
    const feed: FeedRow[] = [row({ kind: "bidSubmitted", state: "bounty", provider: OWNER })];
    assert.equal(hasBidOnBounty(feed, OWNER), true);
    assert.equal(hasBidOnBounty(feed, OTHER), false);
  });
});

describe("badgeInputs — lastActivityTs", () => {
  test("returns the newest row's timestamp involving this owner", () => {
    const feed: FeedRow[] = [
      row({ ts: 5000, consumer: OWNER }),
      row({ ts: 3000, provider: OWNER }),
    ];
    assert.equal(lastActivityTs(feed, OWNER), 5000);
  });

  test("null when the owner has no activity", () => {
    const feed: FeedRow[] = [row({ ts: 5000, consumer: OTHER })];
    assert.equal(lastActivityTs(feed, OWNER), null);
  });
});

describe("badgeInputs — computeRegistrationRanks", () => {
  test("ranks by createdAt ascending, 1-based", () => {
    const ranks = computeRegistrationRanks([
      { owner: "third", createdAt: 300 },
      { owner: "first", createdAt: 100 },
      { owner: "second", createdAt: 200 },
    ]);
    assert.equal(ranks.get("first"), 1);
    assert.equal(ranks.get("second"), 2);
    assert.equal(ranks.get("third"), 3);
  });
});
