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
  bountyPda,
  bidPda,
  jobOfferPda,
  escrowVault,
  stakeVault,
} from "../pdas";
import { IxBuilder, makeIx, toId, toUSDC } from "./utils";

// ── postBounty ────────────────────────────────────────────────────────────────
// Signer = poster.  Creates Bounty PDA + escrow ATA, locks max_amount.

export type PostBountyParams = {
  bountyId: Uint8Array | number[];
  capabilityRequired: string;
  maxAmount: number; // USDC
  minReputation: number;
  biddingDeadline: number; // unix seconds
  deliveryDeadline: number; // unix seconds
  challengeWindowSeconds: number;
  defenseWindowSeconds: number;
  mint: PublicKey;
};

export function buildPostBounty(
  program: Program<Autark>,
  params: PostBountyParams
): IxBuilder {
  const poster = program.provider.publicKey!;
  const id = toId(params.bountyId);
  const bounty = bountyPda(poster, Uint8Array.from(id));
  const wl = mintWhitelistPda();
  const ev = escrowVault(bounty, params.mint);
  const posterAta = getAssociatedTokenAddressSync(params.mint, poster, false);
  const mk = () =>
    program.methods
      .postBounty(
        id,
        params.capabilityRequired,
        toUSDC(params.maxAmount),
        params.minReputation,
        new BN(params.biddingDeadline),
        new BN(params.deliveryDeadline),
        params.challengeWindowSeconds,
        params.defenseWindowSeconds
      )
      .accounts(
        accs({
          bounty,
          mintWhitelist: wl,
          mint: params.mint,
          escrowVault: ev,
          posterTokenAccount: posterAta,
          poster,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
      );
  return makeIx(mk);
}

// ── submitBid ─────────────────────────────────────────────────────────────────
// Signer = bidder.  Bidder must be a registered agent (bidderAgent is verified).

export type SubmitBidParams = {
  bountyPubkey: PublicKey;
  price: number; // USDC
  deliveryDeadline: number; // unix seconds
};

export function buildSubmitBid(
  program: Program<Autark>,
  params: SubmitBidParams
): IxBuilder {
  const bidder = program.provider.publicKey!;
  const bidderAgent = agentPda(bidder);
  const bid = bidPda(params.bountyPubkey, bidder);
  const mk = () =>
    program.methods
      .submitBid(toUSDC(params.price), new BN(params.deliveryDeadline))
      .accounts(
        accs({
          bounty: params.bountyPubkey,
          bidderAgent,
          bid,
          bidder,
          systemProgram: SystemProgram.programId,
        })
      );
  return makeIx(mk);
}

// ── acceptBid ─────────────────────────────────────────────────────────────────
// Signer = poster.  Creates a JobOffer for the winning bidder.
//
// Awarded-bounty job convention:
//   jobOfferPda(poster, bountyPubkey.toBytes())
// The bounty's own pubkey bytes serve as job_id (a bounty awards exactly one job).
// Use awardedJobPda(bountyPubkey) exposed on AutarkIx for callers that need it.

export type AcceptBidParams = {
  bountyId: Uint8Array | number[];
  bidder: PublicKey; // the winning bidder's wallet
  mint: PublicKey;
};

export function buildAcceptBid(
  program: Program<Autark>,
  params: AcceptBidParams
): IxBuilder {
  const poster = program.provider.publicKey!;
  const id = toId(params.bountyId);
  const bounty = bountyPda(poster, Uint8Array.from(id));
  const bid = bidPda(bounty, params.bidder);
  // job_id = bounty pubkey bytes (32 bytes)
  const jobId = bounty.toBytes();
  const job = jobOfferPda(poster, jobId);
  const jobEv = escrowVault(job, params.mint);
  const bountyEv = escrowVault(bounty, params.mint);
  const posterAta = getAssociatedTokenAddressSync(params.mint, poster, false);
  const providerAgent = agentPda(params.bidder);
  const mk = () =>
    program.methods.acceptBid(id).accounts(
      accs({
        bounty,
        bid,
        jobOffer: job,
        jobEscrowVault: jobEv,
        bountyEscrowVault: bountyEv,
        posterTokenAccount: posterAta,
        providerAgent,
        mint: params.mint,
        poster,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    );
  return makeIx(mk);
}

// ── cancelBounty ──────────────────────────────────────────────────────────────
// Signer = poster.  Refunds escrow back to poster.

export type CancelBountyParams = {
  bountyId: Uint8Array | number[];
  mint: PublicKey;
};

export function buildCancelBounty(
  program: Program<Autark>,
  params: CancelBountyParams
): IxBuilder {
  const poster = program.provider.publicKey!;
  const id = toId(params.bountyId);
  const bounty = bountyPda(poster, Uint8Array.from(id));
  const ev = escrowVault(bounty, params.mint);
  const posterAta = getAssociatedTokenAddressSync(params.mint, poster, false);
  const mk = () =>
    program.methods.cancelBounty(id).accounts(
      accs({
        bounty,
        escrowVault: ev,
        posterTokenAccount: posterAta,
        mint: params.mint,
        poster,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    );
  return makeIx(mk);
}

// ── closeBid ──────────────────────────────────────────────────────────────────
// Signer = bidder.  Reclaims rent from an unawarded bid account.

export type CloseBidParams = {
  bountyPubkey: PublicKey;
};

export function buildCloseBid(
  program: Program<Autark>,
  params: CloseBidParams
): IxBuilder {
  const bidder = program.provider.publicKey!;
  const bid = bidPda(params.bountyPubkey, bidder);
  const mk = () =>
    program.methods.closeBid().accounts(
      accs({
        bounty: params.bountyPubkey,
        bid,
        bidder,
      })
    );
  return makeIx(mk);
}
