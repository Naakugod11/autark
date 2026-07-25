"use client";

import { useState } from "react";

export function CopyButton({ text, label = "COPY" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable (insecure context, permissions) — no-op.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        "shrink-0 rounded-sm border px-2 py-1 text-[9px] tracking-[0.14em] transition-colors " +
        (copied
          ? "border-amber text-amber"
          : "border-ink-line text-bone-dim hover:border-bone-faint hover:text-bone")
      }
    >
      {copied ? "COPIED" : label}
    </button>
  );
}
