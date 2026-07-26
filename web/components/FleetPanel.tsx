"use client";

import { useState } from "react";
import { Panel } from "./Panel";
import { AgentCard } from "./AgentCard";
import { DeployModal } from "./DeployModal";
import type { FleetAgent } from "@/lib/economy";

export function FleetPanel({ agents }: { agents: FleetAgent[] }) {
  const [deployOpen, setDeployOpen] = useState(false);

  const sorted = [...agents].sort((a, b) => {
    if (a.openJobs !== b.openJobs) return b.openJobs - a.openJobs;
    return b.scoreVolume - a.scoreVolume;
  });

  return (
    <>
      <Panel
        title={`FLEET · ${agents.length}`}
        className="xl:h-full"
        bodyClassName="flex flex-col xl:overflow-hidden"
        right={
          <button
            type="button"
            onClick={() => setDeployOpen(true)}
            className="border border-ink bg-ink px-2 py-1 text-[9px] tracking-[0.14em] text-bone hover:opacity-80"
          >
            + DEPLOY AGENT
          </button>
        }
      >
        <div className="xl:flex-1 xl:overflow-y-auto">
          {sorted.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-ink-faint">
              no agents registered yet
            </div>
          )}
          {sorted.map((a) => (
            <AgentCard key={a.owner} agent={a} />
          ))}
        </div>
      </Panel>
      {deployOpen && <DeployModal onClose={() => setDeployOpen(false)} />}
    </>
  );
}
