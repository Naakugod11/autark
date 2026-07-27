"use client";

import Image from "next/image";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-ink px-4 text-center text-bone">
      <Image src="/autark-mark-bone.svg" alt="" width={32} height={32} />
      <div>
        <h1 className="text-[13px] tracking-[0.22em] text-danger-ink">SOMETHING BROKE</h1>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-ink-dim">
          {error.message || "Unexpected error rendering this page."}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="border border-bone bg-bone px-3 py-1.5 text-[10px] tracking-[0.14em] text-ink hover:opacity-80"
        >
          RETRY
        </button>
        <Link
          href="/"
          className="border border-ink-line px-3 py-1.5 text-[10px] tracking-[0.14em] text-ink-dim hover:border-bone hover:text-bone"
        >
          ← HOME
        </Link>
      </div>
    </div>
  );
}
