import Image from "next/image";
import { StatusPill } from "./StatusPill";
import { DemoButton } from "./DemoButton";
import type { ConnStatus } from "@/lib/economy";

export function TopBar({ status }: { status: ConnStatus }) {
  return (
    <header className="flex items-center justify-between border-b border-ink bg-bone px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <Image src="/autark-mark.svg" alt="" width={26} height={26} priority />
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-medium tracking-[0.04em] text-ink">autark</span>
          <span className="hidden text-[10px] tracking-[0.2em] text-ink-faint sm:inline">
            AGENT ECONOMY TERMINAL
          </span>
        </div>
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
