import type { FeedState } from "./economy";

export type StateStyle = {
  label: string;
  text: string;
  border: string;
  dot: string;
  glow?: string;
};

export const FEED_STATE_STYLE: Record<FeedState, StateStyle> = {
  proposed:   { label: "PROPOSED",   text: "text-bone-dim",   border: "border-ink-line",  dot: "bg-bone-faint" },
  accepted:   { label: "ACCEPTED",   text: "text-bone",       border: "border-bone-faint", dot: "bg-bone-dim" },
  pending:    { label: "PENDING",    text: "text-amber-dim",  border: "border-amber-dim", dot: "bg-amber-dim" },
  settled:    { label: "SETTLED",    text: "text-amber",      border: "border-amber",     dot: "bg-amber" },
  bounty:     { label: "BOUNTY",     text: "text-bone-dim",   border: "border-ink-line",  dot: "bg-bone-faint" },
  challenged: { label: "DISPUTE",    text: "text-warn",       border: "border-warn",      dot: "bg-warn" },
  defended:   { label: "DEFENDED",   text: "text-amber",      border: "border-amber",     dot: "bg-amber" },
  rejected:   { label: "REJECTED",   text: "text-bone-faint", border: "border-ink-line",  dot: "bg-bone-faint" },
  expired:    { label: "EXPIRED",    text: "text-warn",       border: "border-warn",      dot: "bg-warn" },
  abandoned:  { label: "ABANDONED",  text: "text-warn",       border: "border-warn",      dot: "bg-warn" },
  slash:      { label: "SLASHED",    text: "text-danger",     border: "border-danger",    dot: "bg-danger", glow: "shadow-[0_0_18px_rgba(226,55,58,0.45)]" },
};
