use anchor_lang::prelude::*;

use crate::constants::{MAX_CAPABILITY_LEN, MAX_ENDPOINT_LEN, MAX_NAME_LEN};

// ─── Agent ───────────────────────────────────────────────────────────────────

#[account]
pub struct AgentAccount {
    pub owner: Pubkey,
    pub name: String,
    pub capability: String,
    pub endpoint: String,
    /// Suggested USDC price in micro-USDC (6 decimals), e.g. 1_000_000 = $1.
    pub price_hint: u64,
    pub bump: u8,
}

impl AgentAccount {
    // 8  discriminator
    // 32 owner
    // (4 + MAX_NAME_LEN)       name
    // (4 + MAX_CAPABILITY_LEN) capability
    // (4 + MAX_ENDPOINT_LEN)   endpoint
    // 8  price_hint
    // 1  bump
    pub const SPACE: usize =
        8 + 32 + (4 + MAX_NAME_LEN) + (4 + MAX_CAPABILITY_LEN) + (4 + MAX_ENDPOINT_LEN) + 8 + 1;
    // = 285
}

// ─── Job ─────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum JobStatus {
    Proposed,  // funds locked, awaiting provider response
    Accepted,  // provider accepted, work in progress
    Settled,   // provider delivered, funds released to provider
    Rejected,  // provider declined, funds refunded to consumer
    Expired,   // deadline passed without the required action, funds refunded to consumer
}

#[account]
pub struct JobOffer {
    pub consumer: Pubkey,
    /// Wallet of the provider agent's owner (not the agent PDA key).
    pub provider: Pubkey,
    /// Caller-supplied unique identifier; also a PDA seed so uniqueness
    /// is enforced by PDA collision — duplicate job_id from same consumer
    /// causes `init` on the PDA to fail.
    pub job_id: [u8; 32],
    /// USDC amount locked in escrow, in micro-USDC (6 decimals).
    pub offer_amount: u64,
    /// Provider must call accept_job before this timestamp.
    pub acceptance_deadline: i64,
    /// Provider must call release_escrow before this timestamp,
    /// after which the consumer may call cancel_expired_job.
    pub delivery_deadline: i64,
    pub status: JobStatus,
    /// Set by release_escrow — hash of delivered work stored on-chain as proof.
    pub result_hash: Option<[u8; 32]>,
    pub bump: u8,
}

impl JobOffer {
    // 8  discriminator
    // 32 consumer
    // 32 provider
    // 32 job_id        ([u8;32] — fixed array, no length prefix)
    // 8  offer_amount
    // 8  acceptance_deadline
    // 8  delivery_deadline
    // 1  status        (fieldless enum → u8 variant tag; 5 variants fit)
    // 33 result_hash   (Option<[u8;32]> → 1 tag byte + 32 payload)
    // 1  bump
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 33 + 1;
    // = 163
}
