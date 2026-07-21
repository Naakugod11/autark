import Image from "next/image";
import { StatusPill } from "./StatusPill";
import type { ConnStatus } from "@/lib/economy";

export function TopBar({ status }: { status: ConnStatus }) {
  return (
    <header className="flex items-center justify-between border-b border-ink-line bg-ink px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <Image src="/autark-mark-bone.svg" alt="" width={26} height={26} priority />
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-medium tracking-[0.04em] text-bone">autark</span>
          <span className="hidden text-[10px] tracking-[0.2em] text-bone-faint sm:inline">
            AGENT ECONOMY TERMINAL
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-[10px] tracking-[0.15em] text-bone-faint md:inline">
          PROGRAM FgkicN5…3kLhy
        </span>
        <StatusPill status={status} />
      </div>
    </header>
  );
}
