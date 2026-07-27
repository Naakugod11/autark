import type { ReputationBadge, VanityBadge } from "@/lib/badges";

const TIER_COLOR: Record<ReputationBadge["tier"], string> = {
  bronze: "border-amber-deep text-amber-deep",
  silver: "border-ink-dim text-ink-dim",
  gold: "border-amber text-amber-ink",
  platinum: "border-bone text-bone",
};

// Reputation and vanity badges are rendered by two SEPARATE components with
// deliberately different visual treatments — solid-bordered + tiered color
// for reputation (these are credentials), a plain dashed-border chip for
// vanity (this is flair) — so nobody looking at the page could mistake one
// for the other, per the wall in web/lib/badges.ts.
export function ReputationBadgeRow({ badges }: { badges: ReputationBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <span
          key={b.id}
          title={b.description}
          className={"border px-2 py-1 text-[9px] font-semibold tracking-[0.1em] " + TIER_COLOR[b.tier]}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

export function VanityBadgeRow({ badges }: { badges: VanityBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <span
          key={b.id}
          title={b.description}
          className="border border-dashed border-ink-line px-2 py-1 text-[9px] tracking-[0.1em] text-ink-faint"
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}
