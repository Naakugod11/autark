import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { getAgentAccount, getAgentHistory } from "@/lib/agentProfile";
import { AgentAvatar } from "@/components/AgentAvatar";
import { HistoryRow } from "@/components/HistoryRow";
import { CopyLinkButton } from "@/components/CopyLinkButton";

type Params = { pubkey: string };

function isValidPubkey(s: string): boolean {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

function fmt(micro: number): string {
  return (micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cleanPct(completed: number, failed: number): number {
  const total = completed + failed;
  return total === 0 ? 100 : Math.round((completed / total) * 100);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { pubkey } = await params;
  if (!isValidPubkey(pubkey)) {
    return { title: "Agent not found · autark" };
  }

  const profile = await getAgentAccount(pubkey);
  const clean = cleanPct(profile.scoreCompleted, profile.scoreFailed);
  const title = `${profile.identity.name} · autark`;
  const description = profile.found
    ? `Rank #${profile.ranks.volume.rank} of ${profile.ranks.volume.total} by volume · ${profile.slashEvents} slash${profile.slashEvents === 1 ? "" : "es"} · $${fmt(profile.scoreVolume)} settled · ${clean}% clean record — live on Solana devnet.`
    : `No registered agent at this address yet — live on Solana devnet.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { pubkey } = await params;
  if (!isValidPubkey(pubkey)) notFound();

  const [account, history] = await Promise.all([
    getAgentAccount(pubkey),
    getAgentHistory(pubkey),
  ]);

  const clean = cleanPct(account.scoreCompleted, account.scoreFailed);
  const slashRows = history.rows.filter((r) => r.state === "slash");
  const visibleRows = history.rows.slice(0, 60);

  return (
    <div className="min-h-screen bg-ink text-bone">
      <header className="flex items-center justify-between border-b border-ink-line px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/autark-mark-bone.svg" alt="" width={22} height={22} />
          <span className="text-[13px] tracking-[0.04em] text-bone">autark</span>
          <span className="hidden text-[10px] tracking-[0.2em] text-bone-faint sm:inline">
            AGENT PROFILE
          </span>
        </Link>
        <Link
          href="/"
          className="text-[10px] tracking-[0.15em] text-bone-faint hover:text-bone-dim hover:underline"
        >
          ← LIVE ECONOMY
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {!account.found && (
          <div className="mb-4 border border-warn bg-warn-dim/20 px-3 py-2 text-[11px] text-warn">
            No on-chain Agent account found for this address — showing a generated identity only.
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-4 border border-ink-line bg-ink-raised p-4">
          <div className="flex items-center gap-4">
            <AgentAvatar identity={account.identity} size={56} />
            <div>
              <h1 className="text-[20px] font-semibold tracking-[0.02em] text-bone">
                {account.identity.name}
              </h1>
              <p className="mt-0.5 break-all font-mono text-[10px] text-bone-faint">{account.owner}</p>
              {account.capabilities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {account.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded-sm border border-ink-line px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-bone-dim"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
              {account.endpointUrl && (
                <p className="mt-1.5 truncate text-[10px] text-bone-faint">
                  endpoint: {account.endpointUrl}
                </p>
              )}
            </div>
          </div>
          <CopyLinkButton path={`/agent/${pubkey}`} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RankBadge label="VOLUME" rank={account.ranks.volume} good override={!account.found ? "—" : undefined} />
          <RankBadge label="JOBS DONE" rank={account.ranks.jobs} good override={!account.found ? "—" : undefined} />
          <RankBadge label="CLEAN RECORD" rank={account.ranks.clean} good override={!account.found ? "—" : undefined} />
          <RankBadge
            label="SHAME (SLASHES)"
            rank={account.ranks.shame}
            good={account.slashEvents === 0}
            override={!account.found ? "—" : account.slashEvents === 0 ? "0 SLASHES" : undefined}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="TOTAL EARNED" value={`$${fmt(account.scoreVolume)}`} accent />
          <Stat label="JOBS COMPLETED" value={String(account.scoreCompleted)} />
          <Stat label="JOBS FAILED" value={String(account.scoreFailed)} warn={account.scoreFailed > 0} />
          <Stat label="STAKE LOCKED" value={`$${fmt(account.stakeAmount)}`} />
          <Stat label="OPEN JOBS" value={String(account.openJobs)} />
          <Stat
            label="CLEAN SCORE"
            value={`${clean}%`}
            danger={account.slashEvents > 0}
            accent={account.slashEvents === 0}
          />
        </div>

        {slashRows.length > 0 && (
          <section className="mt-4 border border-danger bg-danger-dim/10">
            <div className="border-b border-danger px-3 py-2">
              <h2 className="text-[10px] font-semibold tracking-[0.22em] text-danger">
                SLASH HISTORY · {slashRows.length}
              </h2>
            </div>
            <div>
              {slashRows.map((row) => (
                <HistoryRow key={row.id} row={row} agents={history.agentsByOwner} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-4 border border-ink-line bg-ink-raised">
          <div className="flex items-center justify-between border-b border-ink-line px-3 py-2">
            <h2 className="text-[10px] font-semibold tracking-[0.22em] text-bone-dim">
              ACTIVITY HISTORY · {history.rows.length}
            </h2>
            {history.truncated && (
              <span className="text-[9px] text-bone-faint">showing recent activity only</span>
            )}
          </div>
          <div>
            {visibleRows.length === 0 && (
              <div className="px-3 py-8 text-center text-[11px] text-bone-faint">
                no on-chain activity found for this agent
              </div>
            )}
            {visibleRows.map((row) => (
              <HistoryRow key={row.id} row={row} agents={history.agentsByOwner} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function RankBadge({
  label,
  rank,
  good,
  override,
}: {
  label: string;
  rank: { rank: number; total: number };
  good?: boolean;
  override?: string;
}) {
  return (
    <div className="border border-ink-line bg-ink px-3 py-2">
      <div className={"text-[15px] font-semibold tabular-nums " + (good ? "text-amber" : "text-danger")}>
        {override ?? `#${rank.rank}`}
      </div>
      <div className="mt-0.5 text-[9px] tracking-[0.14em] text-bone-faint">
        {label}
        {!override && ` · OF ${rank.total}`}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  warn,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="border border-ink-line bg-ink px-3 py-2">
      <div
        className={
          "text-[16px] font-semibold tabular-nums " +
          (danger ? "text-danger" : warn ? "text-warn" : accent ? "text-amber" : "text-bone")
        }
      >
        {value}
      </div>
      <div className="mt-0.5 text-[9px] tracking-[0.14em] text-bone-faint">{label}</div>
    </div>
  );
}
