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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={onClose}
    >
      <div
        className="terminal-grid max-h-[85vh] w-full max-w-lg overflow-y-auto border border-ink bg-bone shadow-[0_8px_40px_rgba(21,18,13,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-line px-4 py-2.5">
          <h2 className="text-[11px] font-semibold tracking-[0.22em] text-ink-dim">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="border border-ink-line px-2 py-0.5 text-[10px] text-ink-faint hover:border-ink hover:text-ink"
          >
            ESC
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
