use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};
use std::cmp::min;

use crate::constants::{
    MAX_CAPABILITY_REQUIRED_LEN, SEED_AGENT, SEED_BID, SEED_BOUNTY, SEED_JOB, SEED_MINT_WHITELIST,
};
use crate::errors::AutarkError;
use crate::state::{Agent, Bid, Bounty, BountyStatus, JobOffer, JobStatus, MintWhitelist};

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct BountyPosted {
    pub bounty: Pubkey,
    pub poster: Pubkey,
    pub capability_required: String,
    pub max_amount: u64,
    pub min_reputation: u32,
}

#[event]
pub struct BidSubmitted {
    pub bounty: Pubkey,
    pub bidder: Pubkey,
    pub price: u64,
}

#[event]
pub struct BountyAwarded {
    pub bounty: Pubkey,
    pub job: Pubkey,
    pub poster: Pubkey,
    pub provider: Pubkey,
    pub price: u64,
    pub refund_to_poster: u64,
}

// ─── post_bounty ─────────────────────────────────────────────────────────────

pub fn post_bounty_handler(
    ctx: Context<PostBounty>,
    _bounty_id: [u8; 32],
    capability_required: String,
    max_amount: u64,
    min_reputation: u32,
    bidding_deadline: i64,
    delivery_deadline: i64,
    challenge_window_seconds: u32,
) -> Result<()> {
    require!(
        capability_required.len() <= MAX_CAPABILITY_REQUIRED_LEN,
        AutarkError::CapabilityTooLong
    );
    require!(max_amount > 0, AutarkError::AmountZero);
    require!(
        bidding_deadline < delivery_deadline,
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
                from: ctx.accounts.poster_token_account.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.poster.to_account_info(),
            },
        ),
        max_amount,
    )?;

    let bounty = &mut ctx.accounts.bounty;
    bounty.poster = ctx.accounts.poster.key();
    bounty.capability_required = capability_required;
    bounty.mint = ctx.accounts.mint.key();
    bounty.max_amount = max_amount;
    bounty.escrow_vault = ctx.accounts.escrow_vault.key();
    bounty.min_reputation = min_reputation;
    bounty.status = BountyStatus::Open;
    bounty.winning_bid = None;
    bounty.bidding_deadline = bidding_deadline;
    bounty.delivery_deadline = delivery_deadline;
    bounty.challenge_window_seconds = challenge_window_seconds;
    bounty.budget_escrow = None;
    bounty.depth = 0;
    bounty.parent_job = None;
    bounty.bid_count = 0;
    bounty.created_at = Clock::get()?.unix_timestamp;
    bounty.bump = ctx.bumps.bounty;

    emit!(BountyPosted {
        bounty: bounty.key(),
        poster: bounty.poster,
        capability_required: bounty.capability_required.clone(),
        max_amount,
        min_reputation,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(bounty_id: [u8; 32])]
pub struct PostBounty<'info> {
    #[account(
        init,
        payer = poster,
        space = 8 + Bounty::INIT_SPACE,
        seeds = [SEED_BOUNTY, poster.key().as_ref(), bounty_id.as_ref()],
        bump,
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(seeds = [SEED_MINT_WHITELIST], bump = mint_whitelist.bump)]
    pub mint_whitelist: Account<'info, MintWhitelist>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = poster,
        associated_token::mint = mint,
        associated_token::authority = bounty,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = poster,
    )]
    pub poster_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub poster: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── submit_bid ──────────────────────────────────────────────────────────────

pub fn submit_bid_handler(ctx: Context<SubmitBid>, price: u64, delivery_deadline: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.bounty.status == BountyStatus::Open
            || ctx.accounts.bounty.status == BountyStatus::Bidding,
        AutarkError::InvalidStatus
    );
    require!(
        now <= ctx.accounts.bounty.bidding_deadline,
        AutarkError::DeadlinePassed
    );
    require!(
        price <= ctx.accounts.bounty.max_amount,
        AutarkError::BidPriceTooHigh
    );
    // Defense in depth: bidder_agent.owner is set at register_agent time using
    // the same pubkey that seeds this Agent PDA, so this is always true by
    // construction — but it's cheap to assert explicitly.
    require_keys_eq!(
        ctx.accounts.bidder_agent.owner,
        ctx.accounts.bidder.key(),
        AutarkError::Unauthorized
    );
    require!(
        ctx.accounts.bidder_agent.score_completed >= ctx.accounts.bounty.min_reputation as u64,
        AutarkError::ReputationTooLow
    );

    let bid = &mut ctx.accounts.bid;
    bid.bounty = ctx.accounts.bounty.key();
    bid.bidder = ctx.accounts.bidder.key();
    bid.price = price;
    bid.delivery_deadline = delivery_deadline;
    bid.created_at = now;
    bid.bump = ctx.bumps.bid;

    let bounty = &mut ctx.accounts.bounty;
    bounty.bid_count = bounty.bid_count.saturating_add(1);
    bounty.status = BountyStatus::Bidding;

    emit!(BidSubmitted {
        bounty: bounty.key(),
        bidder: ctx.accounts.bidder.key(),
        price,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SubmitBid<'info> {
    #[account(mut)]
    pub bounty: Account<'info, Bounty>,

    #[account(
        seeds = [SEED_AGENT, bidder.key().as_ref()],
        bump = bidder_agent.bump,
    )]
    pub bidder_agent: Account<'info, Agent>,

    #[account(
        init,
        payer = bidder,
        space = 8 + Bid::INIT_SPACE,
        seeds = [SEED_BID, bounty.key().as_ref(), bidder.key().as_ref()],
        bump,
    )]
    pub bid: Account<'info, Bid>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ─── accept_bid ──────────────────────────────────────────────────────────────
//
// Produces an Accepted JobOffer that flows through the EXISTING release_escrow
// + claim_settlement instructions unchanged. job_id for the new JobOffer's PDA
// is the bounty's own pubkey bytes — deterministic, one awarded job per bounty,
// no extra argument needed.

pub fn accept_bid_handler(ctx: Context<AcceptBid>, bounty_id: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.bounty.status == BountyStatus::Open
            || ctx.accounts.bounty.status == BountyStatus::Bidding,
        AutarkError::InvalidStatus
    );
    require!(
        ctx.accounts.bounty.winning_bid.is_none(),
        AutarkError::InvalidStatus
    );

    let price = ctx.accounts.bid.price;
    let max_amount = ctx.accounts.bounty.max_amount;
    let refund = max_amount.saturating_sub(price);
    let poster_key = ctx.accounts.bounty.poster;
    let bounty_bump = ctx.accounts.bounty.bump;
    let signer_seeds: &[&[u8]] = &[
        SEED_BOUNTY,
        poster_key.as_ref(),
        bounty_id.as_ref(),
        &[bounty_bump],
    ];

    // 1) move the winning bid price into the new JobOffer's escrow vault.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.bounty_escrow_vault.to_account_info(),
                to: ctx.accounts.job_escrow_vault.to_account_info(),
                authority: ctx.accounts.bounty.to_account_info(),
            },
            &[signer_seeds],
        ),
        price,
    )?;

    // 2) refund the unspent remainder to the poster.
    if refund > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.bounty_escrow_vault.to_account_info(),
                    to: ctx.accounts.poster_token_account.to_account_info(),
                    authority: ctx.accounts.bounty.to_account_info(),
                },
                &[signer_seeds],
            ),
            refund,
        )?;
    }

    // 3) the bounty vault is now empty — close it, rent back to poster.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.bounty_escrow_vault.to_account_info(),
            destination: ctx.accounts.poster.to_account_info(),
            authority: ctx.accounts.bounty.to_account_info(),
        },
        &[signer_seeds],
    ))?;

    let job_offer = &mut ctx.accounts.job_offer;
    job_offer.consumer = poster_key;
    job_offer.provider = ctx.accounts.bid.bidder;
    job_offer.mint = ctx.accounts.mint.key();
    job_offer.amount = price;
    job_offer.escrow_vault = ctx.accounts.job_escrow_vault.key();
    job_offer.status = JobStatus::Accepted;
    job_offer.budget_escrow = None;
    job_offer.depth = 0;
    job_offer.parent_job = None;
    job_offer.acceptance_deadline = ctx.accounts.bid.delivery_deadline;
    job_offer.delivery_deadline = ctx.accounts.bid.delivery_deadline;
    job_offer.challenge_window_seconds = ctx.accounts.bounty.challenge_window_seconds;
    job_offer.settlement_pending_at = None;
    job_offer.counter_count = 0;
    job_offer.created_at = Clock::get()?.unix_timestamp;
    job_offer.bump = ctx.bumps.job_offer;
    job_offer.provider_stake_locked = min(ctx.accounts.provider_agent.stake_amount, price);

    let provider_agent = &mut ctx.accounts.provider_agent;
    provider_agent.open_jobs = provider_agent.open_jobs.saturating_add(1);

    let bid_key = ctx.accounts.bid.key();
    let bounty = &mut ctx.accounts.bounty;
    bounty.winning_bid = Some(bid_key);
    bounty.status = BountyStatus::Awarded;

    emit!(BountyAwarded {
        bounty: bounty.key(),
        job: job_offer.key(),
        poster: poster_key,
        provider: job_offer.provider,
        price,
        refund_to_poster: refund,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(bounty_id: [u8; 32])]
pub struct AcceptBid<'info> {
    #[account(
        mut,
        seeds = [SEED_BOUNTY, poster.key().as_ref(), bounty_id.as_ref()],
        bump = bounty.bump,
        has_one = poster @ AutarkError::Unauthorized,
    )]
    pub bounty: Box<Account<'info, Bounty>>,

    #[account(
        seeds = [SEED_BID, bounty.key().as_ref(), bid.bidder.as_ref()],
        bump = bid.bump,
        has_one = bounty @ AutarkError::BidNotForBounty,
    )]
    pub bid: Box<Account<'info, Bid>>,

    /// The JobOffer this awarded bounty becomes. Same shape, same PDA seeds
    /// scheme (["job", consumer, job_id_32]) as targeted-hire jobs — the
    /// bounty's own pubkey bytes serve as job_id, since a bounty awards at
    /// most one job. release_escrow/claim_settlement do not know or care
    /// whether a JobOffer originated from propose_job or accept_bid.
    #[account(
        init,
        payer = poster,
        space = 8 + JobOffer::INIT_SPACE,
        seeds = [SEED_JOB, poster.key().as_ref(), bounty.key().as_ref()],
        bump,
    )]
    pub job_offer: Box<Account<'info, JobOffer>>,

    #[account(
        init,
        payer = poster,
        associated_token::mint = mint,
        associated_token::authority = job_offer,
    )]
    pub job_escrow_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, address = bounty.escrow_vault)]
    pub bounty_escrow_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = poster,
    )]
    pub poster_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_AGENT, bid.bidder.as_ref()],
        bump = provider_agent.bump,
    )]
    pub provider_agent: Box<Account<'info, Agent>>,

    #[account(address = bounty.mint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub poster: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── cancel_bounty ───────────────────────────────────────────────────────────

pub fn cancel_bounty_handler(ctx: Context<CancelBounty>, bounty_id: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.bounty.status != BountyStatus::Awarded,
        AutarkError::InvalidStatus
    );
    require!(
        ctx.accounts.bounty.status != BountyStatus::Cancelled,
        AutarkError::InvalidStatus
    );

    let max_amount = ctx.accounts.bounty.max_amount;
    let poster_key = ctx.accounts.bounty.poster;
    let bounty_bump = ctx.accounts.bounty.bump;
    let signer_seeds: &[&[u8]] = &[
        SEED_BOUNTY,
        poster_key.as_ref(),
        bounty_id.as_ref(),
        &[bounty_bump],
    ];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.poster_token_account.to_account_info(),
                authority: ctx.accounts.bounty.to_account_info(),
            },
            &[signer_seeds],
        ),
        max_amount,
    )?;

    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.escrow_vault.to_account_info(),
            destination: ctx.accounts.poster.to_account_info(),
            authority: ctx.accounts.bounty.to_account_info(),
        },
        &[signer_seeds],
    ))?;

    ctx.accounts.bounty.status = BountyStatus::Cancelled;
    Ok(())
}

#[derive(Accounts)]
#[instruction(bounty_id: [u8; 32])]
pub struct CancelBounty<'info> {
    #[account(
        mut,
        seeds = [SEED_BOUNTY, poster.key().as_ref(), bounty_id.as_ref()],
        bump = bounty.bump,
        has_one = poster @ AutarkError::Unauthorized,
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(mut, address = bounty.escrow_vault)]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = poster,
    )]
    pub poster_token_account: Account<'info, TokenAccount>,

    #[account(address = bounty.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub poster: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─── close_bid ───────────────────────────────────────────────────────────────

pub fn close_bid_handler(ctx: Context<CloseBid>) -> Result<()> {
    require!(
        ctx.accounts.bounty.status == BountyStatus::Awarded
            || ctx.accounts.bounty.status == BountyStatus::Cancelled,
        AutarkError::InvalidStatus
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CloseBid<'info> {
    pub bounty: Account<'info, Bounty>,

    #[account(
        mut,
        close = bidder,
        seeds = [SEED_BID, bounty.key().as_ref(), bidder.key().as_ref()],
        bump = bid.bump,
        has_one = bidder,
    )]
    pub bid: Account<'info, Bid>,

    #[account(mut)]
    pub bidder: Signer<'info>,
}
