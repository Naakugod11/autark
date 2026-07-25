import type { FeedState } from "./economy";

/**
 * Four state families, per the product spec: settled (good), pending/escrow
 * (neutral/in-flight), challenge/dispute (warning), slash (danger). Every one
 * of the 11 underlying FeedStates maps to exactly one family, and the family
 * — not the individual state — drives the row's dominant visual treatment
 * (left accent bar, background wash, text color). Individual states keep
 * their own badge label so "PROPOSED" still reads differently from
 * "ACCEPTED" even though both are the neutral family.
 */
export type FeedFamily = "pending" | "settled" | "dispute" | "slash";

export const FEED_FAMILY: Record<FeedState, FeedFamily> = {
  proposed: "pending",
  accepted: "pending",
  pending: "pending",
  bounty: "pending",
  rejected: "pending",
  settled: "settled",
  defended: "settled",
  challenged: "dispute",
  expired: "dispute",
  abandoned: "dispute",
  slash: "slash",
};

export type FamilyStyle = {
  label: string;
  text: string; // dominant row text color
  dim: string; // secondary/consumer-side text color within the row
  amount: string; // amount text color
  badgeText: string;
  badgeBorder: string;
  dot: string;
  accent: string; // left border accent bar color
  wash: string; // full-row background tint, always on (not just on hover)
  glow?: string;
};

export const FAMILY_STYLE: Record<FeedFamily, FamilyStyle> = {
  pending: {
    label: "IN-FLIGHT",
    text: "text-bone",
    dim: "text-bone-dim",
    amount: "text-bone-dim",
    badgeText: "text-bone-dim",
    badgeBorder: "border-ink-line",
    dot: "bg-bone-faint",
    accent: "border-bone-faint",
    wash: "",
  },
  settled: {
    label: "SETTLED",
    text: "text-bone",
    dim: "text-bone-dim",
    amount: "text-amber",
    badgeText: "text-amber",
    badgeBorder: "border-amber-dim",
    dot: "bg-amber",
    accent: "border-amber",
    wash: "bg-amber-dim/10",
  },
  dispute: {
    label: "DISPUTE",
    text: "text-warn",
    dim: "text-bone-dim",
    amount: "text-warn",
    badgeText: "text-warn",
    badgeBorder: "border-warn-dim",
    dot: "bg-warn",
    accent: "border-warn",
    wash: "bg-warn-dim/20",
  },
  slash: {
    label: "SLASHED",
    text: "text-danger",
    dim: "text-danger",
    amount: "text-danger",
    badgeText: "text-danger",
    badgeBorder: "border-danger",
    dot: "bg-danger",
    accent: "border-danger",
    wash: "bg-danger-dim/50",
    glow: "shadow-[0_0_18px_rgba(226,55,58,0.45)]",
  },
};

export function familyOf(state: FeedState): FeedFamily {
  return FEED_FAMILY[state];
}

export function familyStyleOf(state: FeedState): FamilyStyle {
  return FAMILY_STYLE[FEED_FAMILY[state]];
}
