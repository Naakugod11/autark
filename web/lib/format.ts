// web/lib/format.ts — tiny display-formatting helpers shared between the
// landing page's server-rendered shell (web/app/page.tsx) and its live
// client-side proof strip (web/components/LiveProofStrip.tsx), so both
// render the exact same string shapes for the same numbers.

export function fmtUsd(micro: number): string {
  return `$${(micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function timeAgo(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
