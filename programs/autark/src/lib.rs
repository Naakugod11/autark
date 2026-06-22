pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy");

#[program]
pub mod autark {
    use super::*;

    // ── Config (deployer-only) ───────────────────────────────────────────────

    pub fn init_mint_whitelist(ctx: Context<InitMintWhitelist>) -> Result<()> {
        instructions::init_mint_whitelist_handler(ctx)
    }

    pub fn add_whitelisted_mint(ctx: Context<AddWhitelistedMint>, mint: Pubkey) -> Result<()> {
        instructions::add_whitelisted_mint_handler(ctx, mint)
    }

    pub fn init_slashing_pool(ctx: Context<InitSlashingPool>) -> Result<()> {
        instructions::init_slashing_pool_handler(ctx)
    }

    // ── Identity + stake ─────────────────────────────────────────────────────

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        capabilities: Vec<String>,
        endpoint_url: String,
        initial_stake: u64,
    ) -> Result<()> {
        instructions::register_agent_handler(ctx, capabilities, endpoint_url, initial_stake)
    }

    pub fn update_agent_capabilities(
        ctx: Context<UpdateAgentCapabilities>,
        new_capabilities: Vec<String>,
        new_endpoint_url: String,
    ) -> Result<()> {
        instructions::update_agent_capabilities_handler(ctx, new_capabilities, new_endpoint_url)
    }

    pub fn stake_deposit(ctx: Context<StakeDeposit>, amount: u64) -> Result<()> {
        instructions::stake_deposit_handler(ctx, amount)
    }

    pub fn stake_withdraw(ctx: Context<StakeWithdraw>, amount: u64) -> Result<()> {
        instructions::stake_withdraw_handler(ctx, amount)
    }

    // ── Targeted-hire happy path ─────────────────────────────────────────────

    pub fn propose_job(
        ctx: Context<ProposeJob>,
        job_id: [u8; 32],
        provider: Pubkey,
        amount: u64,
        acceptance_deadline: i64,
        delivery_deadline: i64,
        challenge_window_seconds: u32,
    ) -> Result<()> {
        instructions::propose_job_handler(
            ctx,
            job_id,
            provider,
            amount,
            acceptance_deadline,
            delivery_deadline,
            challenge_window_seconds,
        )
    }

    pub fn accept_job(ctx: Context<AcceptJob>, job_id: [u8; 32]) -> Result<()> {
        instructions::accept_job_handler(ctx, job_id)
    }

    pub fn release_escrow(ctx: Context<ReleaseEscrow>, job_id: [u8; 32]) -> Result<()> {
        instructions::release_escrow_handler(ctx, job_id)
    }

    /// Single settlement primitive — see settlement.rs. Reused by awarded
    /// bounties in Tier 1b; do not add a parallel claim path for those.
    pub fn claim_settlement(ctx: Context<ClaimSettlement>, job_id: [u8; 32]) -> Result<()> {
        instructions::claim_settlement_handler(ctx, job_id)
    }
}
