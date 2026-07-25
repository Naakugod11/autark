"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
      onClick={onClose}
    >
      <div
        className="terminal-grid max-h-[85vh] w-full max-w-lg overflow-y-auto border border-ink-line bg-ink-raised shadow-[0_0_60px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-line px-4 py-2.5">
          <h2 className="text-[11px] font-semibold tracking-[0.22em] text-bone-dim">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-ink-line px-2 py-0.5 text-[10px] text-bone-faint hover:border-bone-faint hover:text-bone"
          >
            ESC
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
