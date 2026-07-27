"use client";

import { useEffect, useState } from "react";
import type { FeedRow } from "@/lib/economy";

// A full-screen tinted flash reads as neon/gimmicky against the restrained
// system — this is a hard-edged banner at the top of the viewport instead,
// impossible to miss without a color wash over the whole page. On dark, the
// page itself is already Ink, so the drama comes from the danger-red border
// + glow and a solid amber "stamp" on the SLASHED label, not from an
// ink-fill block (that trick only worked when Ink was the odd one out
// against a light page).
export function SlashOverlay({ row }: { row: FeedRow | null }) {
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [prevRowId, setPrevRowId] = useState<string | null>(null);

  if ((row?.id ?? null) !== prevRowId) {
    setPrevRowId(row?.id ?? null);
    if (row) setVisibleId(row.id);
  }

  useEffect(() => {
    if (!visibleId) return;
    const t = setTimeout(() => setVisibleId(null), 2200);
    return () => clearTimeout(t);
  }, [visibleId]);

  const isVisible = !!row && visibleId === row.id;

  return (
    <div
      className={
        "pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3 transition-all duration-300 " +
        (isVisible ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0")
      }
    >
      {row && (
        <div
          key={row.id}
          className="animate-slash-shake flex items-center gap-3 border-2 border-danger bg-ink-overlay px-5 py-2.5 shadow-[0_6px_28px_rgba(229,72,77,0.4)]"
        >
          <span className="shrink-0 bg-amber px-2 py-0.5 text-[11px] font-bold tracking-[0.3em] text-ink">
            SLASHED
          </span>
          <span className="h-3 w-px bg-bone/30" />
          <span className="text-[12px] font-semibold text-bone">{row.headline}</span>
        </div>
      )}
    </div>
  );
}
