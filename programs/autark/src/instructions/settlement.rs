use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{SEED_AGENT, SEED_JOB};
use crate::errors::AutarkError;
use crate::state::{Agent, JobOffer, JobStatus};

// ─── release_escrow ──────────────────────────────────────────────────────────

pub fn release_escrow_handler(ctx: Context<ReleaseEscrow>, _job_id: [u8; 32]) -> Result<()> {
    let job_offer = &mut ctx.accounts.job_offer;
    require!(
        job_offer.status == JobStatus::Accepted,
        AutarkError::InvalidStatus
    );

    job_offer.status = JobStatus::SettlementPending;
    job_offer.settlement_pending_at = Some(Clock::get()?.unix_timestamp);
    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct ReleaseEscrow<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        has_one = provider @ AutarkError::NotProvider,
    )]
    pub job_offer: Account<'info, JobOffer>,

    pub provider: Signer<'info>,
}

// ─── claim_settlement ────────────────────────────────────────────────────────
//
// Anyone may crank this once the challenge window has elapsed. This is the
// single settlement primitive: a Tier 1b awarded bounty settles by becoming
// a JobOffer and flowing through this exact instruction — do not add a
// parallel "claim_bounty_settlement" path.

pub fn claim_settlement_handler(ctx: Context<ClaimSettlement>, job_id: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job_offer = &ctx.accounts.job_offer;

    require!(
        job_offer.status == JobStatus::SettlementPending,
        AutarkError::InvalidStatus
    );
    let window_end = job_offer
        .settlement_pending_at
        .ok_or(AutarkError::InvalidStatus)?
        .saturating_add(job_offer.challenge_window_seconds as i64);
    require!(now >= window_end, AutarkError::ChallengeWindowNotElapsed);

    let amount = job_offer.amount;
    let consumer_key = job_offer.consumer;
    let bump = job_offer.bump;
    let signer_seeds: &[&[u8]] = &[SEED_JOB, consumer_key.as_ref(), job_id.as_ref(), &[bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.provider_token_account.to_account_info(),
                authority: ctx.accounts.job_offer.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    let job_offer = &mut ctx.accounts.job_offer;
    job_offer.status = JobStatus::Settled;
    job_offer.provider_stake_locked = 0;

    let agent = &mut ctx.accounts.provider_agent;
    agent.score_completed = agent.score_completed.saturating_add(1);
    agent.score_volume = agent.score_volume.saturating_add(amount);
    agent.open_jobs = agent.open_jobs.saturating_sub(1);

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct ClaimSettlement<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(
        mut,
        seeds = [SEED_AGENT, job_offer.provider.as_ref()],
        bump = provider_agent.bump,
    )]
    pub provider_agent: Account<'info, Agent>,

    #[account(mut, address = job_offer.escrow_vault)]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = provider_wallet,
    )]
    pub provider_token_account: Account<'info, TokenAccount>,

    /// CHECK: only used as the ATA-authority reference for provider_token_account;
    /// authenticity enforced by the `address = job_offer.provider` constraint.
    #[account(address = job_offer.provider)]
    pub provider_wallet: UncheckedAccount<'info>,

    #[account(address = job_offer.mint)]
    pub mint: Account<'info, Mint>,

    /// Anyone may crank settlement — no constraint beyond being a fee payer.
    pub cranker: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
