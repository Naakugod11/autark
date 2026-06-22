use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    constants::SEED_JOB,
    error::AgentBazaarError,
    state::{JobOffer, JobStatus},
};

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct CancelExpiredJob<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        // Consumer is the authorized caller — only they can reclaim their funds.
        has_one = consumer @ AgentBazaarError::InvalidConsumer,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = job_offer,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = consumer,
    )]
    pub consumer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub consumer: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── Handler ─────────────────────────────────────────────────────────────────

pub fn handler(ctx: Context<CancelExpiredJob>, _job_id: [u8; 32]) -> Result<()> {
    let clock = Clock::get()?;
    let job_offer = &ctx.accounts.job_offer;

    // One instruction handles two distinct timeout paths.
    // The match on status determines which deadline applies.
    match job_offer.status {
        JobStatus::Proposed => {
            // Provider never responded — acceptance window closed.
            require!(
                clock.unix_timestamp > job_offer.acceptance_deadline,
                AgentBazaarError::JobNotExpired
            );
        }
        JobStatus::Accepted => {
            // Provider accepted but didn't deliver — delivery window closed.
            // Consumer must call this before provider calls release_escrow;
            // whichever lands first wins (by design).
            require!(
                clock.unix_timestamp > job_offer.delivery_deadline,
                AgentBazaarError::JobNotExpired
            );
        }
        // Settled, Rejected, Expired — all terminal, nothing to cancel.
        _ => return Err(AgentBazaarError::JobNotCancellable.into()),
    }

    let consumer = job_offer.consumer;
    let job_id = job_offer.job_id;
    let bump = job_offer.bump;
    let offer_amount = job_offer.offer_amount;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.consumer_token_account.to_account_info(),
                authority: ctx.accounts.job_offer.to_account_info(),
            },
            &[&[SEED_JOB, consumer.as_ref(), &job_id, &[bump]]],
        ),
        offer_amount,
    )?;

    ctx.accounts.job_offer.status = JobStatus::Expired;

    Ok(())
}
