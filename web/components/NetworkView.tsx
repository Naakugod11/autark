"use client";

import { useEconomyContext } from "@/components/EconomyProvider";
import { TopBar } from "@/components/TopBar";
import { NetworkGraph } from "@/components/NetworkGraph";
import { ConnectionError } from "@/components/ConnectionError";
import type { GraphEdge } from "@/lib/graph";
import type { FeedRow } from "@/lib/economy";

export function NetworkView({
  baseEdges,
  baseRows,
  baseMaxTs,
}: {
  baseEdges: GraphEdge[];
  baseRows: FeedRow[];
  baseMaxTs: number;
}) {
  const { status, error } = useEconomyContext();

  return (
    <div className="flex min-h-screen flex-col bg-ink text-bone xl:h-screen xl:overflow-hidden">
      <TopBar status={status} />
      {status === "error" ? (
        <ConnectionError message={error} />
      ) : (
        <main className="flex flex-1 flex-col gap-2 p-2 xl:min-h-0">
          <NetworkGraph baseEdges={baseEdges} baseRows={baseRows} baseMaxTs={baseMaxTs} />
        </main>
      )}
    </div>
  );
}
