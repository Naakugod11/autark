import { BN, Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { Autark } from "../../../target/types/autark";
import { accs } from "../client";
import {
  agentPda,
  mintWhitelistPda,
  jobOfferPda,
  slashingPoolPda,
  escrowVault,
  stakeVault,
  poolVault,
} from "../pdas";
import { IxBuilder, makeIx, toId, toUSDC } from "./utils";

// ── proposeJob ────────────────────────────────────────────────────────────────
// Signer = consumer. Creates JobOffer PDA + escrow ATA, transfers amount.
// provider is a PUBKEY arg, not a checked account — the signer chose the agent.

export type ProposeJobParams = {
  jobId: Uint8Array | number[];
  provider: PublicKey; // provider's WALLET pubkey (arg, not an account)
  amount: number; // USDC
  acceptanceDeadline: number; // unix seconds
  deliveryDeadline: number; // unix seconds
  challengeWindowSeconds: number;
  defenseWindowSeconds: number;
  mint: PublicKey;
};

export function buildProposeJob(
  program: Program<Autark>,
  params: ProposeJobParams
): IxBuilder {
  if (params.acceptanceDeadline >= params.deliveryDeadline) {
    throw new Error("acceptanceDeadline must be before deliveryDeadline");
  }
  const consumer = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(consumer, Uint8Array.from(id));
  const wl = mintWhitelistPda();
  const ev = escrowVault(job, params.mint);
  const consumerAta = getAssociatedTokenAddressSync(params.mint, consumer, false);
  const mk = () =>
    program.methods
      .proposeJob(
        id,
        params.provider,
        toUSDC(params.amount),
        new BN(params.acceptanceDeadline),
        new BN(params.deliveryDeadline),
        params.challengeWindowSeconds,
        params.defenseWindowSeconds
      )
      .accounts(
        accs({
          jobOffer: job,
          mintWhitelist: wl,
          mint: params.mint,
          escrowVault: ev,
          consumerTokenAccount: consumerAta,
          consumer,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
      );
  return makeIx(mk);
}

// ── acceptJob ─────────────────────────────────────────────────────────────────
// Signer = provider.  Increments agent.open_jobs.

export type AcceptJobParams = {
  consumer: PublicKey;
  jobId: Uint8Array | number[];
};

export function buildAcceptJob(
  program: Program<Autark>,
  params: AcceptJobParams
): IxBuilder {
  const provider = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(params.consumer, Uint8Array.from(id));
  const agent = agentPda(provider);
  const mk = () =>
    program.methods.acceptJob(id).accounts(
      accs({
        jobOffer: job,
        agent,
        provider,
      })
    );
  return makeIx(mk);
}

// ── rejectJob ─────────────────────────────────────────────────────────────────
// Signer = provider.  Honest decline, Proposed only — no slash.

export type RejectJobParams = {
  consumer: PublicKey;
  jobId: Uint8Array | number[];
  mint: PublicKey;
};

export function buildRejectJob(
  program: Program<Autark>,
  params: RejectJobParams
): IxBuilder {
  const provider = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(params.consumer, Uint8Array.from(id));
  const ev = escrowVault(job, params.mint);
  const consumerAta = getAssociatedTokenAddressSync(
    params.mint,
    params.consumer,
    false
  );
  const mk = () =>
    program.methods.rejectJob(id).accounts(
      accs({
        jobOffer: job,
        escrowVault: ev,
        consumerTokenAccount: consumerAta,
        mint: params.mint,
        provider,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    );
  return makeIx(mk);
}

// ── releaseEscrow ─────────────────────────────────────────────────────────────
// Signer = provider.  Moves job to SettlementPending — consumer has
// challenge_window_seconds to open a challenge before claimSettlement can fire.

export type ReleaseEscrowParams = {
  consumer: PublicKey;
  jobId: Uint8Array | number[];
};

export function buildReleaseEscrow(
  program: Program<Autark>,
  params: ReleaseEscrowParams
): IxBuilder {
  const provider = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(params.consumer, Uint8Array.from(id));
  const mk = () =>
    program.methods.releaseEscrow(id).accounts(
      accs({
        jobOffer: job,
        provider,
      })
    );
  return makeIx(mk);
}

// ── claimSettlement ───────────────────────────────────────────────────────────
// Cranker (signer) = anyone.  Can only be called after challenge_window expires
// without a challenge being opened.
// providerWallet is enforced on-chain by `address = job_offer.provider`.

export type ClaimSettlementParams = {
  consumer: PublicKey;
  jobId: Uint8Array | number[];
  providerWallet: PublicKey;
  mint: PublicKey;
};

export function buildClaimSettlement(
  program: Program<Autark>,
  params: ClaimSettlementParams
): IxBuilder {
  const cranker = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(params.consumer, Uint8Array.from(id));
  const providerAgent = agentPda(params.providerWallet);
  const ev = escrowVault(job, params.mint);
  const providerAta = getAssociatedTokenAddressSync(
    params.mint,
    params.providerWallet,
    false
  );
  const mk = () =>
    program.methods.claimSettlement(id).accounts(
      accs({
        jobOffer: job,
        providerAgent,
        escrowVault: ev,
        providerTokenAccount: providerAta,
        providerWallet: params.providerWallet,
        mint: params.mint,
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    );
  return makeIx(mk);
}

// ── cancelExpiredJob ──────────────────────────────────────────────────────────
// Cranker (signer) = anyone.  Handles both Proposed→Expired and
// Accepted→Abandoned with their respective slash formulas.

export type CancelExpiredJobParams = {
  consumer: PublicKey;
  jobId: Uint8Array | number[];
  provider: PublicKey; // provider's wallet, for providerAgent + stake vault
  mint: PublicKey;
};

export function buildCancelExpiredJob(
  program: Program<Autark>,
  params: CancelExpiredJobParams
): IxBuilder {
  const cranker = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(params.consumer, Uint8Array.from(id));
  const ev = escrowVault(job, params.mint);
  const consumerAta = getAssociatedTokenAddressSync(
    params.mint,
    params.consumer,
    false
  );
  const provAgent = agentPda(params.provider);
  const provSv = stakeVault(provAgent, params.mint);
  const pool = slashingPoolPda();
  const poolV = poolVault(pool, params.mint);
  const mk = () =>
    program.methods.cancelExpiredJob(id).accounts(
      accs({
        jobOffer: job,
        escrowVault: ev,
        consumerTokenAccount: consumerAta,
        providerAgent: provAgent,
        providerStakeVault: provSv,
        slashingPool: pool,
        slashingPoolVault: poolV,
        mint: params.mint,
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    );
  return makeIx(mk);
}
