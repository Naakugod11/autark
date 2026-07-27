"use client";

import { useEconomyContext } from "@/components/EconomyProvider";
import { TopBar } from "@/components/TopBar";
import { NetworkGraph } from "@/components/NetworkGraph";
import { ConnectionError } from "@/components/ConnectionError";

export function NetworkView() {
  const { status, error } = useEconomyContext();

  return (
    <div className="flex min-h-screen flex-col bg-ink text-bone xl:h-screen xl:overflow-hidden">
      <TopBar status={status} />
      {status === "error" ? (
        <ConnectionError message={error} />
      ) : (
        <main className="flex flex-1 flex-col gap-2 p-2 xl:min-h-0">
          <NetworkGraph />
        </main>
      )}
    </div>
  );
}
