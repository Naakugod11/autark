import type { FeedState } from "./economy";

/**
 * Four state families, per the product spec: settled (good), pending/escrow
 * (neutral/in-flight), dispute (warning), slash (danger). Every one of the
 * 11 underlying FeedStates maps to exactly one family, and the family — not
 * the individual state — drives the row's dominant visual treatment.
 * Individual states keep their own badge label so "PROPOSED" still reads
 * differently from "ACCEPTED" even though both are the neutral family.
 *
 * `defended` (challengeDefended, and challengeResolved with defended=true)
 * is dispute-family, not settled-family: a challenge happened either way —
 * whether it resolves via defense or slash is a different outcome WITHIN
 * the same dispute lifecycle, not a clean no-drama settlement. Related
 * events (challengeOpened / challengeDefended / a defended
 * challengeResolved) read as one family with different resolutions, distinguished
 * by badge text ("DISPUTE OPEN" vs "DEFENDED") rather than a different color family.
 *
 * Colorblind/small-screen safety: each family is distinguishable by THREE
 * independent signals, not hue alone —
 *   1. glyph shape (○ neutral · ● positive · ▲ caution · ✕ failure — a
 *      widely-understood semiotic set on its own)
 *   2. left-rule weight, escalating 1px → 2px → 3px → full block
 *   3. tag treatment: plain text → thin outline → filled outline → solid
 *      stamp (inverted colors)
 * The four together form the escalation ladder end to end: weight, fill,
 * and urgency all climb from pending to slash in lockstep.
 */
export type FeedFamily = "pending" | "settled" | "dispute" | "slash";

export const FEED_FAMILY: Record<FeedState, FeedFamily> = {
  proposed: "pending",
  accepted: "pending",
  pending: "pending",
  bounty: "pending",
  rejected: "pending",
  settled: "settled",
  defended: "dispute",
  challenged: "dispute",
  expired: "dispute",
  abandoned: "dispute",
  slash: "slash",
};

export type FamilyStyle = {
  label: string;
  glyph: string; // shape marker — the colorblind/small-screen-safe signal
  glyphColor: string;
  text: string; // dominant row text color (the party that matters — provider)
  dim: string; // secondary/consumer-side text color
  amount: string; // amount text color
  badgeText: string;
  badgeBorder: string;
  badgeFill: string;
  accent: string; // left rule color
  ruleWidth: string; // left rule weight class — escalation ladder
  wash: string; // full-row background tint
  block?: boolean; // true only for slash — full ink-inversion row
};

export const FAMILY_STYLE: Record<FeedFamily, FamilyStyle> = {
  pending: {
    label: "IN-FLIGHT",
    glyph: "○",
    glyphColor: "text-ink-faint",
    text: "text-ink",
    dim: "text-ink-faint",
    amount: "text-ink-dim",
    badgeText: "text-ink-faint",
    badgeBorder: "border-ink-line",
    badgeFill: "",
    accent: "border-l-ink-line",
    ruleWidth: "border-l",
    wash: "",
  },
  settled: {
    // Amber stays reserved for money amounts and the slash moment (brand
    // rule) — settled distinguishes itself by glyph (filled vs. pending's
    // hollow dot), a heavier neutral rule, and its badge text, not color.
    // The one amber touch is the dollar figure itself.
    label: "SETTLED",
    glyph: "●",
    glyphColor: "text-ink-dim",
    text: "text-ink",
    dim: "text-ink-faint",
    amount: "text-amber-ink",
    badgeText: "text-ink-dim",
    badgeBorder: "border-ink",
    badgeFill: "",
    accent: "border-l-ink",
    ruleWidth: "border-l-2",
    wash: "",
  },
  dispute: {
    label: "DISPUTE",
    glyph: "▲",
    glyphColor: "text-warn-ink",
    text: "text-warn-ink",
    dim: "text-ink-faint",
    amount: "text-warn-ink",
    badgeText: "text-warn-ink",
    badgeBorder: "border-warn-ink",
    badgeFill: "bg-warn-wash",
    accent: "border-l-warn-ink",
    ruleWidth: "border-l-[3px]",
    wash: "bg-warn-wash/50",
  },
  slash: {
    label: "SLASHED",
    glyph: "✕",
    glyphColor: "text-danger",
    text: "text-bone",
    dim: "text-bone/65",
    amount: "text-amber",
    badgeText: "text-ink",
    badgeBorder: "border-amber",
    badgeFill: "bg-amber",
    accent: "border-l-danger",
    ruleWidth: "border-l-4",
    wash: "bg-ink",
    block: true,
  },
};

export function familyOf(state: FeedState): FeedFamily {
  return FEED_FAMILY[state];
}

export function familyStyleOf(state: FeedState): FamilyStyle {
  return FAMILY_STYLE[FEED_FAMILY[state]];
}
