// web/components/TxLink.tsx — Task 3: "every event everywhere should be one
// click from its on-chain proof." One shared link so every feed row (the
// terminal, profile history, and the network graph's node/edge panels) all
// point at the exact same place — Solscan's devnet explorer for the tx
// signature — instead of each surface growing its own copy.
//
// `iconOnly` renders just the arrow glyph (no signature text) — used inline
// in FeedRowItem so the terminal's dense mobile row gets a one-click link to
// on-chain proof without adding meaningful width at 390px.
export function TxLink({
  signature,
  className,
  iconOnly,
}: {
  signature: string;
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <a
      href={`https://solscan.io/tx/${signature}?cluster=devnet`}
      target="_blank"
      rel="noreferrer"
      title={`view ${signature} on Solscan`}
      onClick={(e) => e.stopPropagation()}
      className={className ?? "shrink-0 tabular-nums text-ink-faint hover:text-bone hover:underline"}
    >
      {iconOnly ? "↗" : `${signature.slice(0, 6)}…${signature.slice(-4)} ↗`}
    </a>
  );
}
