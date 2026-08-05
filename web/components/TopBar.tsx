"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusPill } from "./StatusPill";
import { DemoButton } from "./DemoButton";
import type { ConnStatus } from "@/lib/economy";

const NAV = [
  { href: "/terminal", label: "TERMINAL" },
  { href: "/network", label: "NETWORK" },
] as const;

export function TopBar({ status }: { status: ConnStatus }) {
  const pathname = usePathname();
  return (
    <header className="flex flex-wrap items-center justify-between gap-y-2 border-b border-ink-line bg-ink px-4 py-3 sm:px-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/autark-mark-bone.svg" alt="" width={26} height={26} priority />
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-medium tracking-[0.04em] text-bone">autark</span>
            <span className="hidden text-[10px] tracking-[0.2em] text-ink-faint sm:inline">
              AGENT ECONOMY TERMINAL
            </span>
          </div>
        </Link>
        <nav className="flex items-center gap-1 border-l border-ink-line pl-4">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "border px-2 py-1 text-[9px] tracking-[0.14em] transition-colors " +
                  (active
                    ? "border-bone bg-bone text-ink"
                    : "border-ink-line text-ink-faint hover:text-bone")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <a
          href="https://explorer.solana.com/address/FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy?cluster=devnet"
          target="_blank"
          rel="noreferrer"
          className="hidden text-[10px] tracking-[0.15em] text-ink-faint hover:text-ink-dim hover:underline md:inline"
        >
          PROGRAM FgkicN5…3kLhy ↗
        </a>
        <DemoButton />
        <StatusPill status={status} />
      </div>
    </header>
  );
}
