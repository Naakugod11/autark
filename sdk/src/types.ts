import { BN, Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import type { Autark } from "../../target/types/autark";

// ── Enum types ────────────────────────────────────────────────────────────────
// Anchor 1.0 deserialises enum variants as { proposed: {} }, not strings.

export type JobStatus =
  | "proposed"
  | "countered"
  | "accepted"
  | "settlementPending"
  | "challenged"
  | "settled"
  | "rejected"
  | "expired"
  | "abandoned"
  | "burned";

export type BountyStatus = "open" | "bidding" | "awarded" | "cancelled";

export type ChallengeState = "open" | "defended";

// Extracts the single key from an Anchor enum object — already camelCase.
function parseEnum<T extends string>(raw: unknown): T {
  return Object.keys(raw as Record<string, unknown>)[0] as T;
}

function bn(v: unknown): number {
  return (v as BN).toNumber();
}

function bnOpt(v: unknown): number | null {
  return v == null ? null : bn(v);
}

// ── Account shapes ────────────────────────────────────────────────────────────

export type AgentData = {
  pubkey: PublicKey;
  owner: PublicKey;
  capabilities: string[];
  endpointUrl: string;
  stakeAmount: number;
  stakeVault: PublicKey;
  scoreCompleted: number;
  scoreFailed: number;
  scoreVolume: number;
  slashEvents: number;
  lastSlashSlot: number;
  createdAt: number;
  openJobs: number;
  bump: number;
};

export type JobOfferData = {
  pubkey: PublicKey;
  consumer: PublicKey;
  provider: PublicKey;
  mint: PublicKey;
  amount: number;
  escrowVault: PublicKey;
  status: JobStatus;
  budgetEscrow: PublicKey | null;
  depth: number;
  parentJob: PublicKey | null;
  acceptanceDeadline: number;
  deliveryDeadline: number;
  challengeWindowSeconds: number;
  defenseWindowSeconds: number;
  settlementPendingAt: number | null;
  counterCount: number;
  providerStakeLocked: number;
  createdAt: number;
  bump: number;
  jobId: number[];
};

export type BountyData = {
  pubkey: PublicKey;
  poster: PublicKey;
  capabilityRequired: string;
  mint: PublicKey;
  maxAmount: number;
  escrowVault: PublicKey;
  minReputation: number;
  status: BountyStatus;
  winningBid: PublicKey | null;
  biddingDeadline: number;
  deliveryDeadline: number;
  challengeWindowSeconds: number;
  defenseWindowSeconds: number;
  budgetEscrow: PublicKey | null;
  depth: number;
  parentJob: PublicKey | null;
  bidCount: number;
  createdAt: number;
  bump: number;
};

export type BidData = {
  pubkey: PublicKey;
  bounty: PublicKey;
  bidder: PublicKey;
  price: number;
  deliveryDeadline: number;
  createdAt: number;
  bump: number;
};

export type ChallengeData = {
  pubkey: PublicKey;
  job: PublicKey;
  challenger: PublicKey;
  defender: PublicKey;
  mint: PublicKey;
  stakeVault: PublicKey;
  challengeStake: number;
  defenseStake: number;
  state: ChallengeState;
  openedAt: number;
  defenseDeadline: number;
  defendedAt: number;
  bump: number;
};

export type SlashingPoolData = {
  pubkey: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  totalSlashed: number;
  bump: number;
};

export type MintWhitelistData = {
  pubkey: PublicKey;
  authority: PublicKey;
  mints: PublicKey[];
  bump: number;
};

// ── Fetchers ──────────────────────────────────────────────────────────────────
// Use `as any` for raw Anchor account data — Anchor 1.0 deserialises snake_case
// IDL field names to camelCase at runtime, but the TS types file keeps
// snake_case, so direct property access would conflict with tsc.

export async function fetchAgent(
  program: Program<Autark>,
  pubkey: PublicKey
): Promise<AgentData> {
  const r: any = await program.account.agent.fetch(pubkey);
  return {
    pubkey,
    owner: r.owner,
    capabilities: r.capabilities,
    endpointUrl: r.endpointUrl,
    stakeAmount: bn(r.stakeAmount),
    stakeVault: r.stakeVault,
    scoreCompleted: bn(r.scoreCompleted),
    scoreFailed: bn(r.scoreFailed),
    scoreVolume: bn(r.scoreVolume),
    slashEvents: r.slashEvents,
    lastSlashSlot: bn(r.lastSlashSlot),
    createdAt: bn(r.createdAt),
    openJobs: r.openJobs,
    bump: r.bump,
  };
}

export async function fetchAllAgents(
  program: Program<Autark>
): Promise<AgentData[]> {
  const all = await program.account.agent.all();
  return all.map((a) => {
    const r: any = a.account;
    return {
      pubkey: a.publicKey,
      owner: r.owner,
      capabilities: r.capabilities,
      endpointUrl: r.endpointUrl,
      stakeAmount: bn(r.stakeAmount),
      stakeVault: r.stakeVault,
      scoreCompleted: bn(r.scoreCompleted),
      scoreFailed: bn(r.scoreFailed),
      scoreVolume: bn(r.scoreVolume),
      slashEvents: r.slashEvents,
      lastSlashSlot: bn(r.lastSlashSlot),
      createdAt: bn(r.createdAt),
      openJobs: r.openJobs,
      bump: r.bump,
    };
  });
}

export async function fetchJobOffer(
  program: Program<Autark>,
  pubkey: PublicKey
): Promise<JobOfferData> {
  const r: any = await program.account.jobOffer.fetch(pubkey);
  return {
    pubkey,
    consumer: r.consumer,
    provider: r.provider,
    mint: r.mint,
    amount: bn(r.amount),
    escrowVault: r.escrowVault,
    status: parseEnum<JobStatus>(r.status),
    budgetEscrow: r.budgetEscrow ?? null,
    depth: r.depth,
    parentJob: r.parentJob ?? null,
    acceptanceDeadline: bn(r.acceptanceDeadline),
    deliveryDeadline: bn(r.deliveryDeadline),
    challengeWindowSeconds: r.challengeWindowSeconds,
    defenseWindowSeconds: r.defenseWindowSeconds,
    settlementPendingAt: bnOpt(r.settlementPendingAt),
    counterCount: r.counterCount,
    providerStakeLocked: bn(r.providerStakeLocked),
    createdAt: bn(r.createdAt),
    bump: r.bump,
    jobId: Array.from(r.jobId as number[]),
  };
}

export async function fetchAllJobOffers(
  program: Program<Autark>
): Promise<JobOfferData[]> {
  const all = await program.account.jobOffer.all();
  return all.map((a) => {
    const r: any = a.account;
    return {
      pubkey: a.publicKey,
      consumer: r.consumer,
      provider: r.provider,
      mint: r.mint,
      amount: bn(r.amount),
      escrowVault: r.escrowVault,
      status: parseEnum<JobStatus>(r.status),
      budgetEscrow: r.budgetEscrow ?? null,
      depth: r.depth,
      parentJob: r.parentJob ?? null,
      acceptanceDeadline: bn(r.acceptanceDeadline),
      deliveryDeadline: bn(r.deliveryDeadline),
      challengeWindowSeconds: r.challengeWindowSeconds,
      defenseWindowSeconds: r.defenseWindowSeconds,
      settlementPendingAt: bnOpt(r.settlementPendingAt),
      counterCount: r.counterCount,
      providerStakeLocked: bn(r.providerStakeLocked),
      createdAt: bn(r.createdAt),
      bump: r.bump,
      jobId: Array.from(r.jobId as number[]),
    };
  });
}

export async function fetchBounty(
  program: Program<Autark>,
  pubkey: PublicKey
): Promise<BountyData> {
  const r: any = await program.account.bounty.fetch(pubkey);
  return {
    pubkey,
    poster: r.poster,
    capabilityRequired: r.capabilityRequired,
    mint: r.mint,
    maxAmount: bn(r.maxAmount),
    escrowVault: r.escrowVault,
    minReputation: r.minReputation,
    status: parseEnum<BountyStatus>(r.status),
    winningBid: r.winningBid ?? null,
    biddingDeadline: bn(r.biddingDeadline),
    deliveryDeadline: bn(r.deliveryDeadline),
    challengeWindowSeconds: r.challengeWindowSeconds,
    defenseWindowSeconds: r.defenseWindowSeconds,
    budgetEscrow: r.budgetEscrow ?? null,
    depth: r.depth,
    parentJob: r.parentJob ?? null,
    bidCount: r.bidCount,
    createdAt: bn(r.createdAt),
    bump: r.bump,
  };
}

export async function fetchBid(
  program: Program<Autark>,
  pubkey: PublicKey
): Promise<BidData> {
  const r: any = await program.account.bid.fetch(pubkey);
  return {
    pubkey,
    bounty: r.bounty,
    bidder: r.bidder,
    price: bn(r.price),
    deliveryDeadline: bn(r.deliveryDeadline),
    createdAt: bn(r.createdAt),
    bump: r.bump,
  };
}

export async function fetchChallenge(
  program: Program<Autark>,
  pubkey: PublicKey
): Promise<ChallengeData> {
  const r: any = await program.account.challenge.fetch(pubkey);
  return {
    pubkey,
    job: r.job,
    challenger: r.challenger,
    defender: r.defender,
    mint: r.mint,
    stakeVault: r.stakeVault,
    challengeStake: bn(r.challengeStake),
    defenseStake: bn(r.defenseStake),
    state: parseEnum<ChallengeState>(r.state),
    openedAt: bn(r.openedAt),
    defenseDeadline: bn(r.defenseDeadline),
    defendedAt: bn(r.defendedAt),
    bump: r.bump,
  };
}

export async function fetchSlashingPool(
  program: Program<Autark>,
  pubkey: PublicKey
): Promise<SlashingPoolData> {
  const r: any = await program.account.slashingPool.fetch(pubkey);
  return {
    pubkey,
    mint: r.mint,
    vault: r.vault,
    totalSlashed: bn(r.totalSlashed),
    bump: r.bump,
  };
}

export async function fetchMintWhitelist(
  program: Program<Autark>,
  pubkey: PublicKey
): Promise<MintWhitelistData> {
  const r: any = await program.account.mintWhitelist.fetch(pubkey);
  return {
    pubkey,
    authority: r.authority,
    mints: r.mints as PublicKey[],
    bump: r.bump,
  };
}
