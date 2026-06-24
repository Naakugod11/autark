import { Program } from "@anchor-lang/core";
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
  jobOfferPda,
  challengePda,
  slashingPoolPda,
  escrowVault,
  challengeVault,
  stakeVault,
  poolVault,
} from "../pdas";
import { IxBuilder, makeIx, toId } from "./utils";

// ── challengeSettlement ───────────────────────────────────────────────────────
// Signer = consumer.  Opens a Challenge PDA + stake vault ATA, consumer
// locks job.amount as challenge stake.

export type ChallengeSettlementParams = {
  jobId: Uint8Array | number[];
  mint: PublicKey;
};

export function buildChallengeSettlement(
  program: Program<Autark>,
  params: ChallengeSettlementParams
): IxBuilder {
  const consumer = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(consumer, Uint8Array.from(id));
  const challenge = challengePda(job);
  const sv = challengeVault(challenge, params.mint);
  const consumerAta = getAssociatedTokenAddressSync(
    params.mint,
    consumer,
    false
  );
  const mk = () =>
    program.methods.challengeSettlement(id).accounts(
      accs({
        jobOffer: job,
        challenge,
        stakeVault: sv,
        consumerTokenAccount: consumerAta,
        mint: params.mint,
        consumer,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    );
  return makeIx(mk);
}

// ── defendChallenge ───────────────────────────────────────────────────────────
// Signer = provider.  Provider posts defense stake into the challenge vault.

export type DefendChallengeParams = {
  consumer: PublicKey; // to derive jobOfferPda
  jobId: Uint8Array | number[];
  mint: PublicKey;
};

export function buildDefendChallenge(
  program: Program<Autark>,
  params: DefendChallengeParams
): IxBuilder {
  const provider = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(params.consumer, Uint8Array.from(id));
  const challenge = challengePda(job);
  const sv = challengeVault(challenge, params.mint);
  const providerAta = getAssociatedTokenAddressSync(
    params.mint,
    provider,
    false
  );
  const mk = () =>
    program.methods.defendChallenge(id).accounts(
      accs({
        jobOffer: job,
        challenge,
        stakeVault: sv,
        providerTokenAccount: providerAta,
        mint: params.mint,
        provider,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    );
  return makeIx(mk);
}

// ── resolveChallenge ──────────────────────────────────────────────────────────
// Cranker (signer) = anyone, callable once defense_deadline has passed.
// Two resolution branches (defended / undefended) — same instruction, program
// branches on challenge.state.
//
// consumerAgent is an OPTIONAL account (Anchor optional-accounts convention).
// Pass null when the consumer is not a registered Agent.

export type ResolveChallengeParams = {
  consumer: PublicKey;
  jobId: Uint8Array | number[];
  provider: PublicKey; // provider wallet — for providerAgent + stakeVault
  challenger: PublicKey; // challenge.challenger (= consumer who opened the dispute)
  mint: PublicKey;
  consumerAgent?: PublicKey | null;
};

export function buildResolveChallenge(
  program: Program<Autark>,
  params: ResolveChallengeParams
): IxBuilder {
  const cranker = program.provider.publicKey!;
  const id = toId(params.jobId);
  const job = jobOfferPda(params.consumer, Uint8Array.from(id));
  const challenge = challengePda(job);
  const ev = escrowVault(job, params.mint);
  const challengeSv = challengeVault(challenge, params.mint);
  const pool = slashingPoolPda();
  const poolV = poolVault(pool, params.mint);
  const provAgent = agentPda(params.provider);
  const provSv = stakeVault(provAgent, params.mint);
  const consumerAta = getAssociatedTokenAddressSync(
    params.mint,
    params.consumer,
    false
  );
  const providerAta = getAssociatedTokenAddressSync(
    params.mint,
    params.provider,
    false
  );
  // Anchor optional-account sentinel: pass null — Anchor encodes it as the
  // program ID (SystemProgram / TokenProgram depending on IDL), or just null
  // which Anchor 1.0 handles by omitting the account in the CPI call.
  const consumerAgent = params.consumerAgent ?? null;
  const mk = () =>
    program.methods.resolveChallenge(id).accounts(
      accs({
        jobOffer: job,
        challenge,
        challenger: params.challenger,
        escrowVault: ev,
        challengeStakeVault: challengeSv,
        slashingPool: pool,
        slashingPoolVault: poolV,
        providerAgent: provAgent,
        providerStakeVault: provSv,
        consumerAgent,
        consumerTokenAccount: consumerAta,
        providerTokenAccount: providerAta,
        mint: params.mint,
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    );
  return makeIx(mk);
}
