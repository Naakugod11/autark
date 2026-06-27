use anchor_lang::prelude::*;

// ─── Agent ───────────────────────────────────────────────────────────────────

/// seeds: ["agent", owner]
#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub owner: Pubkey,
    /// <=8 tags, <=32 chars each
    #[max_len(8, 32)]
    pub capabilities: Vec<String>,
    #[max_len(128)]
    pub endpoint_url: String,
    pub stake_amount: u64,
    pub stake_vault: Pubkey,
    pub score_completed: u64,
    pub score_failed: u64,
    pub score_volume: u64,
    pub slash_events: u32,
    pub last_slash_slot: u64,
    pub created_at: i64,
    pub bump: u8,
    /// # of non-terminal jobs where this agent is provider.
    /// Incremented on accept_job, decremented when a job reaches a terminal
    /// state. stake_withdraw requires open_jobs == 0.
    pub open_jobs: u16,
}

// ─── MintWhitelist ───────────────────────────────────────────────────────────

/// seeds: ["mint_whitelist"]  (global singleton)
#[account]
#[derive(InitSpace)]
pub struct MintWhitelist {
    pub authority: Pubkey,
    #[max_len(16)]
    pub mints: Vec<Pubkey>,
    pub bump: u8,
}

// ─── SlashingPool ────────────────────────────────────────────────────────────

/// seeds: ["slashing_pool"]  (singleton)
#[account]
#[derive(InitSpace)]
pub struct SlashingPool {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub total_slashed: u64,
    pub bump: u8,
}

// ─── JobOffer ────────────────────────────────────────────────────────────────

/// seeds: ["job", consumer, job_id_32]
#[account]
#[derive(InitSpace)]
pub struct JobOffer {
    pub consumer: Pubkey,
    pub provider: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub escrow_vault: Pubkey,
    pub status: JobStatus,
    pub budget_escrow: Option<Pubkey>,
    pub depth: u8,
    pub parent_job: Option<Pubkey>,
    pub acceptance_deadline: i64,
    pub delivery_deadline: i64,
    /// Gates the challenge window.
    pub challenge_window_seconds: u32,
    /// Gates how long a provider has to defend an opened challenge before
    /// resolve_challenge can be cranked. Parallels challenge_window_seconds:
    /// a per-job param, not a hardcoded constant.
    pub defense_window_seconds: u32,
    /// Set on release_escrow.
    pub settlement_pending_at: Option<i64>,
    pub counter_count: u8,
    pub created_at: i64,
    pub bump: u8,
    /// Earmark recorded at accept_job = min(agent.stake_amount, job.amount).
    /// Tier 1 only sets/clears it; Tier 2 slashing will read it. Released
    /// (logically) on settle.
    pub provider_stake_locked: u64,
    // NOTE: all dispute-specific state (stakes, defense window, dispute enum)
    // lives on the separate Challenge account below, NOT here. Do not add
    // challenge_stake / defense_stake fields to JobOffer.
    /// The 32-byte seed used to derive this PDA. Stored so providers can
    /// discover targeted-hire jobs via a provider memcmp scan and reconstruct
    /// the PDA without an out-of-band hint.
    pub job_id: [u8; 32],
}

// ─── Bounty ──────────────────────────────────────────────────────────────────

/// seeds: ["bounty", poster, bounty_id_32]
#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub poster: Pubkey,
    #[max_len(64)]
    pub capability_required: String,
    pub mint: Pubkey,
    pub max_amount: u64,
    pub escrow_vault: Pubkey,
    pub min_reputation: u32,
    pub status: BountyStatus,
    pub winning_bid: Option<Pubkey>,
    pub bidding_deadline: i64,
    pub delivery_deadline: i64,
    /// Copied onto the awarded JobOffer's challenge_window_seconds.
    pub challenge_window_seconds: u32,
    /// Copied onto the awarded JobOffer's defense_window_seconds.
    pub defense_window_seconds: u32,
    pub budget_escrow: Option<Pubkey>,
    pub depth: u8,
    pub parent_job: Option<Pubkey>,
    pub bid_count: u16,
    pub created_at: i64,
    pub bump: u8,
}

// ─── Bid ─────────────────────────────────────────────────────────────────────

/// seeds: ["bid", bounty, bidder]
#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub bounty: Pubkey,
    pub bidder: Pubkey,
    pub price: u64,
    pub delivery_deadline: i64,
    pub created_at: i64,
    pub bump: u8,
}

// ─── Challenge ───────────────────────────────────────────────────────────────

/// seeds: ["challenge", job]  -- externalized dispute state
#[account]
#[derive(InitSpace)]
pub struct Challenge {
    pub job: Pubkey,
    /// = job.consumer at challenge time
    pub challenger: Pubkey,
    /// = job.provider
    pub defender: Pubkey,
    pub mint: Pubkey,
    /// ATA owned by this PDA, holds BOTH stakes.
    pub stake_vault: Pubkey,
    /// == job.amount
    pub challenge_stake: u64,
    /// 0 until defended
    pub defense_stake: u64,
    pub state: ChallengeState,
    pub opened_at: i64,
    pub defense_deadline: i64,
    /// 0 if never defended
    pub defended_at: i64,
    pub bump: u8,
}

// ─── BudgetEscrow ────────────────────────────────────────────────────────────

/// seeds: ["budget", requester, budget_id_32]
///
/// Part of the account model, but no v1 instruction constructs it --
/// recursion instructions are deferred to v2. Defined now for a stable model.
#[account]
#[derive(InitSpace)]
#[allow(dead_code)]
pub struct BudgetEscrow {
    pub requester: Pubkey,
    pub root_agent: Pubkey,
    pub mint: Pubkey,
    pub amount_initial: u64,
    pub amount_remaining: u64,
    pub depth_limit: u8,
    pub ttl_slot: u64,
    pub vault: Pubkey,
    pub bump: u8,
}

// ─── Enums ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum JobStatus {
    Proposed,
    Countered,
    Accepted,
    SettlementPending,
    Challenged,
    Settled,
    Rejected,
    Expired,
    Abandoned,
    Burned,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum BountyStatus {
    Open,
    Bidding,
    Awarded,
    Cancelled,
}

/// Account closes on resolve, so there is no Resolved variant.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum ChallengeState {
    Open,
    Defended,
}