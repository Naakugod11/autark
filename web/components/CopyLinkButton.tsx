"use client";

import { useState } from "react";

export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable — no-op.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        "shrink-0 rounded-sm border px-2.5 py-1.5 text-[10px] tracking-[0.14em] transition-colors " +
        (copied
          ? "border-amber text-amber"
          : "border-ink-line text-bone-dim hover:border-bone-faint hover:text-bone")
      }
    >
      {copied ? "LINK COPIED" : "COPY LINK ↗"}
    </button>
  );
}
