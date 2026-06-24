import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export const PROGRAM_ID = new PublicKey(
  "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy"
);

// ── Singleton PDAs ────────────────────────────────────────────────────────────

export function mintWhitelistPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_whitelist")],
    PROGRAM_ID
  )[0];
}

export function slashingPoolPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("slashing_pool")],
    PROGRAM_ID
  )[0];
}

// ── Per-entity PDAs ───────────────────────────────────────────────────────────

// seeds: ["agent", owner]
export function agentPda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

// seeds: ["job", consumer, job_id[32]]
export function jobOfferPda(consumer: PublicKey, jobId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), consumer.toBuffer(), Buffer.from(jobId)],
    PROGRAM_ID
  )[0];
}

// seeds: ["bounty", poster, bounty_id[32]]
export function bountyPda(poster: PublicKey, bountyId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bounty"), poster.toBuffer(), Buffer.from(bountyId)],
    PROGRAM_ID
  )[0];
}

// seeds: ["bid", bounty, bidder]
export function bidPda(bounty: PublicKey, bidder: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), bounty.toBuffer(), bidder.toBuffer()],
    PROGRAM_ID
  )[0];
}

// seeds: ["challenge", job_offer]
export function challengePda(jobOffer: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("challenge"), jobOffer.toBuffer()],
    PROGRAM_ID
  )[0];
}

// MISMATCH FLAG: prompt specifies budgetEscrow ["budget", requester, budgetId[32]]
// but the on-chain IDL has NO BudgetEscrow account type — budget_escrow fields in
// JobOffer and Bounty are Option<Pubkey> addresses whose derivation may live in a
// not-yet-IDL-tracked account.  Included here for callers that need the address.
export function budgetEscrowPda(
  requester: PublicKey,
  budgetId: Uint8Array
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("budget"), requester.toBuffer(), Buffer.from(budgetId)],
    PROGRAM_ID
  )[0];
}

// ── ATA helpers ───────────────────────────────────────────────────────────────
// All PDA-owned vaults require allowOwnerOffCurve=true.

// Agent's stake vault: ATA(agentPda, mint)
export function stakeVault(agentAddr: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, agentAddr, true);
}

// JobOffer's escrow vault: ATA(jobOfferPda, mint)
export function escrowVault(jobAddr: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, jobAddr, true);
}

// Challenge's stake vault: ATA(challengePda, mint)
export function challengeVault(
  challengeAddr: PublicKey,
  mint: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(mint, challengeAddr, true);
}

// SlashingPool's vault: ATA(slashingPoolPda, mint)
export function poolVault(poolAddr: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, poolAddr, true);
}
