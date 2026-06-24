import { Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import type { Autark } from "../../../target/types/autark";
import { jobOfferPda } from "../pdas";

import {
  buildInitMintWhitelist,
  buildAddWhitelistedMint,
  buildInitSlashingPool,
  AddWhitelistedMintParams,
  InitSlashingPoolParams,
} from "./config";
import {
  buildRegisterAgent,
  buildUpdateAgentCapabilities,
  buildStakeDeposit,
  buildStakeWithdraw,
  RegisterAgentParams,
  UpdateAgentCapabilitiesParams,
  StakeDepositParams,
  StakeWithdrawParams,
} from "./agent";
import {
  buildProposeJob,
  buildAcceptJob,
  buildRejectJob,
  buildReleaseEscrow,
  buildClaimSettlement,
  buildCancelExpiredJob,
  ProposeJobParams,
  AcceptJobParams,
  RejectJobParams,
  ReleaseEscrowParams,
  ClaimSettlementParams,
  CancelExpiredJobParams,
} from "./job";
import {
  buildPostBounty,
  buildSubmitBid,
  buildAcceptBid,
  buildCancelBounty,
  buildCloseBid,
  PostBountyParams,
  SubmitBidParams,
  AcceptBidParams,
  CancelBountyParams,
  CloseBidParams,
} from "./bounty";
import {
  buildChallengeSettlement,
  buildDefendChallenge,
  buildResolveChallenge,
  ChallengeSettlementParams,
  DefendChallengeParams,
  ResolveChallengeParams,
} from "./dispute";

export * from "./utils";
export * from "./config";
export * from "./agent";
export * from "./job";
export * from "./bounty";
export * from "./dispute";

// ── AutarkIx ──────────────────────────────────────────────────────────────────
// Assembled instruction-builder namespace, exposed on AutarkClient as .ix.

export type AutarkIx = ReturnType<typeof makeAutarkIx>;

export function makeAutarkIx(program: Program<Autark>) {
  return {
    // ── config ──────────────────────────────────────────────────────────────
    initMintWhitelist: () => buildInitMintWhitelist(program),
    addWhitelistedMint: (p: AddWhitelistedMintParams) =>
      buildAddWhitelistedMint(program, p),
    initSlashingPool: (p: InitSlashingPoolParams) =>
      buildInitSlashingPool(program, p),

    // ── agent ────────────────────────────────────────────────────────────────
    registerAgent: (p: RegisterAgentParams) => buildRegisterAgent(program, p),
    updateAgentCapabilities: (p: UpdateAgentCapabilitiesParams) =>
      buildUpdateAgentCapabilities(program, p),
    stakeDeposit: (p: StakeDepositParams) => buildStakeDeposit(program, p),
    stakeWithdraw: (p: StakeWithdrawParams) => buildStakeWithdraw(program, p),

    // ── job ──────────────────────────────────────────────────────────────────
    proposeJob: (p: ProposeJobParams) => buildProposeJob(program, p),
    acceptJob: (p: AcceptJobParams) => buildAcceptJob(program, p),
    rejectJob: (p: RejectJobParams) => buildRejectJob(program, p),
    releaseEscrow: (p: ReleaseEscrowParams) => buildReleaseEscrow(program, p),
    claimSettlement: (p: ClaimSettlementParams) =>
      buildClaimSettlement(program, p),
    cancelExpiredJob: (p: CancelExpiredJobParams) =>
      buildCancelExpiredJob(program, p),

    // ── bounty ───────────────────────────────────────────────────────────────
    postBounty: (p: PostBountyParams) => buildPostBounty(program, p),
    submitBid: (p: SubmitBidParams) => buildSubmitBid(program, p),
    acceptBid: (p: AcceptBidParams) => buildAcceptBid(program, p),
    cancelBounty: (p: CancelBountyParams) => buildCancelBounty(program, p),
    closeBid: (p: CloseBidParams) => buildCloseBid(program, p),

    // ── dispute ──────────────────────────────────────────────────────────────
    challengeSettlement: (p: ChallengeSettlementParams) =>
      buildChallengeSettlement(program, p),
    defendChallenge: (p: DefendChallengeParams) =>
      buildDefendChallenge(program, p),
    resolveChallenge: (p: ResolveChallengeParams) =>
      buildResolveChallenge(program, p),

    // ── helpers ──────────────────────────────────────────────────────────────
    // The JobOffer PDA for an awarded bounty: poster is the consumer, job_id =
    // bountyPubkey bytes (32 bytes serving as job_id per the IDL convention).
    awardedJobPda: (bountyPubkey: PublicKey): PublicKey =>
      jobOfferPda(program.provider.publicKey!, bountyPubkey.toBytes()),
  };
}
