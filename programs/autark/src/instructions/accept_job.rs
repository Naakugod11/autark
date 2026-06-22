use anchor_lang::prelude::*;

use crate::{
    constants::SEED_JOB,
    error::AgentBazaarError,
    state::{JobOffer, JobStatus},
};

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct AcceptJob<'info> {
    /// `mut` — we write status: Proposed → Accepted.
    ///
    /// `seeds` — we use `job_offer.consumer` (read from the deserialized
    ///   account) rather than passing consumer as a separate account.
    ///   Anchor loads and deserializes the account first, then evaluates
    ///   the seeds constraint. The PDA check is: derive PDA from
    ///   [SEED_JOB, job_offer.consumer, job_id] and verify it matches the
    ///   address of the account that was passed. This prevents an attacker
    ///   from passing a different PDA or a keypair account.
    ///
    /// `bump = job_offer.bump` — we use the stored bump instead of calling
    ///   find_program_address (saves ~10k compute units per call).
    ///
    /// `has_one = provider @ AgentBazaarError::InvalidProvider`
    ///   — Anchor checks that job_offer.provider == provider.key().
    ///   This is the core authorization check: only the wallet named as
    ///   provider at propose_job time can call accept_job. Without this,
    ///   any signer could accept any job.
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        has_one = provider @ AgentBazaarError::InvalidProvider,
    )]
    pub job_offer: Account<'info, JobOffer>,

    /// Provider does not pay for anything here — no `mut` needed.
    /// `Signer` is the only constraint: we just need their signature
    /// to authorize the state transition.
    pub provider: Signer<'info>,
}

// ─── Handler ─────────────────────────────────────────────────────────────────

pub fn handler(ctx: Context<AcceptJob>, _job_id: [u8; 32]) -> Result<()> {
    let clock = Clock::get()?;
    let job_offer = &ctx.accounts.job_offer;

    require!(
        job_offer.status == JobStatus::Proposed,
        AgentBazaarError::JobNotProposed
    );
    require!(
        clock.unix_timestamp <= job_offer.acceptance_deadline,
        AgentBazaarError::JobExpired
    );

    ctx.accounts.job_offer.status = JobStatus::Accepted;

    Ok(())
}
