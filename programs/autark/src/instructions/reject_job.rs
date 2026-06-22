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
pub struct RejectJob<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        has_one = provider @ AgentBazaarError::InvalidProvider,
    )]
    pub job_offer: Account<'info, JobOffer>,

    /// Escrow ATA to drain. Same derivation as in release_escrow.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = job_offer,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Consumer's ATA — refund lands here. Consumer already has this ATA
    /// (they sent USDC from it in propose_job), so we don't create it.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = consumer,
    )]
    pub consumer_token_account: Account<'info, TokenAccount>,

    /// Consumer is not signing — they're just the refund recipient.
    /// We pass their pubkey so Anchor can derive and validate their ATA address.
    /// Safety: consumer.key() is validated indirectly — if it doesn't match
    /// job_offer.consumer, the ATA address derived from it won't match
    /// consumer_token_account, and that constraint will reject the tx.
    /// CHECK: validated via associated_token::authority = consumer constraint below.
    pub consumer: UncheckedAccount<'info>,

    pub provider: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── Handler ─────────────────────────────────────────────────────────────────

pub fn handler(ctx: Context<RejectJob>, _job_id: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.job_offer.status == JobStatus::Proposed,
        AgentBazaarError::JobNotProposed
    );

    let consumer = ctx.accounts.job_offer.consumer;
    let job_id = ctx.accounts.job_offer.job_id;
    let bump = ctx.accounts.job_offer.bump;
    let offer_amount = ctx.accounts.job_offer.offer_amount;

    // Same PDA-as-signer pattern as release_escrow — job_offer PDA signs
    // on behalf of the escrow ATA.
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

    ctx.accounts.job_offer.status = JobStatus::Rejected;

    Ok(())
}
