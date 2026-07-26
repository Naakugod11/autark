"use client";

import { useEffect, useState } from "react";
import type { FeedRow } from "@/lib/economy";

// A full-screen tinted flash reads as neon/gimmicky against the light,
// restrained system — this is the "ink-heavy inversion block" solution
// applied at the top of the viewport instead: a hard-edged black banner
// that slides in, impossible to miss without any glow or color wash.
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
          className="animate-slash-shake flex items-center gap-3 border-2 border-danger bg-ink px-5 py-2.5 shadow-[0_6px_24px_rgba(21,18,13,0.35)]"
        >
          <span className="shrink-0 text-[11px] font-bold tracking-[0.3em] text-danger">SLASHED</span>
          <span className="h-3 w-px bg-bone/30" />
          <span className="text-[12px] font-semibold text-bone">{row.headline}</span>
        </div>
      )}
    </div>
  );
}
