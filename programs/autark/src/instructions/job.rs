use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use std::cmp::min;

use crate::constants::{SEED_AGENT, SEED_JOB, SEED_MINT_WHITELIST};
use crate::errors::AutarkError;
use crate::state::{Agent, JobOffer, JobStatus, MintWhitelist};

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct JobProposed {
    pub job: Pubkey,
    pub consumer: Pubkey,
    pub provider: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
    pub delivery_deadline: i64,
}

#[event]
pub struct JobAccepted {
    pub job: Pubkey,
    pub provider: Pubkey,
    pub amount: u64,
    pub stake_locked: u64,
    pub provider_open_jobs: u16,
}

// ─── propose_job ─────────────────────────────────────────────────────────────
//
// Consumer is any wallet — not required to be a registered Agent. Recursion
// (budget_escrow/parent_job/depth) and negotiation (counter_count) are out of
// scope for this tier; fields are initialized to their base values.

pub fn propose_job_handler(
    ctx: Context<ProposeJob>,
    _job_id: [u8; 32],
    provider: Pubkey,
    amount: u64,
    acceptance_deadline: i64,
    delivery_deadline: i64,
    challenge_window_seconds: u32,
    defense_window_seconds: u32,
) -> Result<()> {
    require!(amount > 0, AutarkError::AmountZero);
    require!(
        acceptance_deadline < delivery_deadline,
        AutarkError::InvalidDeadlines
    );
    require!(
        ctx.accounts
            .mint_whitelist
            .mints
            .contains(&ctx.accounts.mint.key()),
        AutarkError::MintNotWhitelisted
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.consumer_token_account.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.consumer.to_account_info(),
            },
        ),
        amount,
    )?;

    let job_offer = &mut ctx.accounts.job_offer;
    job_offer.consumer = ctx.accounts.consumer.key();
    job_offer.provider = provider;
    job_offer.mint = ctx.accounts.mint.key();
    job_offer.amount = amount;
    job_offer.escrow_vault = ctx.accounts.escrow_vault.key();
    job_offer.status = JobStatus::Proposed;
    job_offer.budget_escrow = None;
    job_offer.depth = 0;
    job_offer.parent_job = None;
    job_offer.acceptance_deadline = acceptance_deadline;
    job_offer.delivery_deadline = delivery_deadline;
    job_offer.challenge_window_seconds = challenge_window_seconds;
    job_offer.defense_window_seconds = defense_window_seconds;
    job_offer.settlement_pending_at = None;
    job_offer.counter_count = 0;
    job_offer.created_at = Clock::get()?.unix_timestamp;
    job_offer.bump = ctx.bumps.job_offer;
    job_offer.provider_stake_locked = 0;

    emit!(JobProposed {
        job: job_offer.key(),
        consumer: job_offer.consumer,
        provider,
        amount,
        mint: job_offer.mint,
        delivery_deadline,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct ProposeJob<'info> {
    #[account(
        init,
        payer = consumer,
        space = 8 + JobOffer::INIT_SPACE,
        seeds = [SEED_JOB, consumer.key().as_ref(), job_id.as_ref()],
        bump,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(seeds = [SEED_MINT_WHITELIST], bump = mint_whitelist.bump)]
    pub mint_whitelist: Account<'info, MintWhitelist>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = consumer,
        associated_token::mint = mint,
        associated_token::authority = job_offer,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = consumer,
    )]
    pub consumer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub consumer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── accept_job ──────────────────────────────────────────────────────────────

pub fn accept_job_handler(ctx: Context<AcceptJob>, _job_id: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.job_offer.status == JobStatus::Proposed,
        AutarkError::InvalidStatus
    );
    require!(
        now <= ctx.accounts.job_offer.acceptance_deadline,
        AutarkError::DeadlinePassed
    );
    // Defense in depth: agent.owner is set at register_agent time using the
    // same pubkey that seeds this Agent PDA, so this is always true by
    // construction — but it's cheap to assert explicitly.
    require_keys_eq!(
        ctx.accounts.agent.owner,
        ctx.accounts.provider.key(),
        AutarkError::NotProvider
    );

    let job_offer = &mut ctx.accounts.job_offer;
    let agent = &mut ctx.accounts.agent;

    job_offer.provider_stake_locked = min(agent.stake_amount, job_offer.amount);
    job_offer.status = JobStatus::Accepted;
    agent.open_jobs = agent.open_jobs.saturating_add(1);

    emit!(JobAccepted {
        job: job_offer.key(),
        provider: ctx.accounts.provider.key(),
        amount: job_offer.amount,
        stake_locked: job_offer.provider_stake_locked,
        provider_open_jobs: agent.open_jobs,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct AcceptJob<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        has_one = provider @ AutarkError::NotProvider,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(
        mut,
        seeds = [SEED_AGENT, provider.key().as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, Agent>,

    pub provider: Signer<'info>,
}
