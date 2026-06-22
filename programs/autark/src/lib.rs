pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy");

#[program]
pub mod autark {
    use super::*;

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        capability: String,
        endpoint: String,
        price_hint: u64,
    ) -> Result<()> {
        instructions::register_agent::handler(ctx, name, capability, endpoint, price_hint)
    }

    pub fn propose_job(
        ctx: Context<ProposeJob>,
        job_id: [u8; 32],
        offer_amount: u64,
        acceptance_deadline: i64,
        delivery_deadline: i64,
    ) -> Result<()> {
        instructions::propose_job::handler(
            ctx,
            job_id,
            offer_amount,
            acceptance_deadline,
            delivery_deadline,
        )
    }

    pub fn accept_job(ctx: Context<AcceptJob>, job_id: [u8; 32]) -> Result<()> {
        instructions::accept_job::handler(ctx, job_id)
    }

    pub fn release_escrow(
        ctx: Context<ReleaseEscrow>,
        job_id: [u8; 32],
        result_hash: [u8; 32],
    ) -> Result<()> {
        instructions::release_escrow::handler(ctx, job_id, result_hash)
    }

    pub fn reject_job(ctx: Context<RejectJob>, job_id: [u8; 32]) -> Result<()> {
        instructions::reject_job::handler(ctx, job_id)
    }

    pub fn cancel_expired_job(ctx: Context<CancelExpiredJob>, job_id: [u8; 32]) -> Result<()> {
        instructions::cancel_expired_job::handler(ctx, job_id)
    }
}
