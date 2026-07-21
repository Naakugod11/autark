"use client";

import { useEffect, useState } from "react";
import type { FeedRow } from "@/lib/economy";

export function SlashOverlay({ row }: { row: FeedRow | null }) {
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [prevRowId, setPrevRowId] = useState<string | null>(null);

  if ((row?.id ?? null) !== prevRowId) {
    setPrevRowId(row?.id ?? null);
    if (row) setVisibleId(row.id);
  }

  useEffect(() => {
    if (!visibleId) return;
    const t = setTimeout(() => setVisibleId(null), 1000);
    return () => clearTimeout(t);
  }, [visibleId]);

  if (!row || visibleId !== row.id) return null;

  return (
    <div
      key={row.id}
      className="pointer-events-none fixed inset-0 z-50 animate-slash-flash bg-danger/20"
    >
      <div className="flex h-full items-center justify-center px-4">
        <div className="animate-slash-shake rounded-sm border-2 border-danger bg-ink/95 px-6 py-4 text-center shadow-[0_0_60px_rgba(226,55,58,0.5)] sm:px-10 sm:py-5">
          <div className="text-[11px] tracking-[0.35em] text-danger">SLASH EXECUTED</div>
          <div className="mt-1.5 text-base font-bold text-bone sm:text-lg">{row.headline}</div>
        </div>
      </div>
    </div>
  );
}
