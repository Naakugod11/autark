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
 * Color: each family owns a clearly distinct hue, used on its glyph, left
 * rule, and tag consistently — pending stays ink-neutral (nothing has
 * happened worth flagging yet), settled is green (an addition to the
 * palette scoped to state semantics only — see globals.css), dispute is the
 * amber family, slash is a deep danger red plus the amber "stamp" fill.
 * Rules/glyphs/accents use the bare mid-saturation variant of each color
 * (small marks/borders); text/badge-text use the "-ink" twin — on dark that
 * twin is the BRIGHT one (the reverse of the light system, where "-ink" was
 * the deep variant safe on bone) since text now sits directly on Ink and
 * needs to be light enough to read (verified — see globals.css).
 *
 * Colorblind/small-screen safety on top of color, not instead of it — each
 * family is ALSO distinguishable by:
 *   1. glyph shape (○ neutral · ● positive · ▲ caution · ✕ failure — a
 *      widely-understood semiotic set on its own)
 *   2. left-rule weight, escalating 1px → 2px → 3px → full block
 *   3. tag treatment: plain text → filled pill → filled pill → solid stamp
 * The four together form the escalation ladder end to end: hue, weight,
 * fill, and urgency all climb from pending to slash in lockstep.
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
  amount: string; // amount text color — amber for money, brand-wide rule
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
    text: "text-bone",
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
    label: "SETTLED",
    glyph: "●",
    glyphColor: "text-green-ink",
    text: "text-green-ink",
    dim: "text-ink-faint",
    amount: "text-amber-ink", // money stays amber — the one brand-wide constant
    badgeText: "text-green-ink",
    badgeBorder: "border-green-ink",
    badgeFill: "bg-green-wash",
    accent: "border-l-green",
    ruleWidth: "border-l-2",
    wash: "bg-green-wash/50",
  },
  dispute: {
    label: "DISPUTE",
    glyph: "▲",
    glyphColor: "text-amber-ink",
    text: "text-amber-ink",
    dim: "text-ink-faint",
    amount: "text-amber-ink",
    badgeText: "text-amber-ink",
    badgeBorder: "border-amber-ink",
    badgeFill: "bg-amber-wash",
    accent: "border-l-amber",
    ruleWidth: "border-l-[3px]",
    wash: "bg-amber-wash/50",
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
    // Ink is the page's own base surface now, so a plain ink fill (the old
    // light-mode "inversion block" trick) would be invisible here — the
    // slash row instead gets its own deep danger-red fill, the one place
    // besides the SlashOverlay stamp where danger runs as a fill instead of
    // a border/glyph accent.
    wash: "bg-danger-wash",
    block: true,
  },
};

export function familyOf(state: FeedState): FeedFamily {
  return FEED_FAMILY[state];
}

export function familyStyleOf(state: FeedState): FamilyStyle {
  return FAMILY_STYLE[FEED_FAMILY[state]];
}
