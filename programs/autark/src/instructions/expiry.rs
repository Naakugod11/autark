use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{SEED_AGENT, SEED_JOB, SEED_SLASHING_POOL, SLASH_PCT_ABANDONED, SLASH_PCT_PROPOSED_EXPIRED};
use crate::errors::AutarkError;
use crate::instructions::slashing::slash_provider_stake;
use crate::state::{Agent, JobOffer, JobStatus, SlashingPool};

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct JobRejected {
    pub job: Pubkey,
    pub provider: Pubkey,
    pub refunded: u64,
}

#[event]
pub struct JobExpired {
    pub job: Pubkey,
    pub provider: Pubkey,
    pub refunded: u64,
    pub slashed: u64,
    /// POST-update provider Agent counter. slash_events is deliberately
    /// absent: per the reputation table, Expired does NOT bump slash_events
    /// (unlike Abandoned / lost-challenge) — see the handler comment.
    pub score_failed: u64,
}

#[event]
pub struct JobAbandoned {
    pub job: Pubkey,
    pub provider: Pubkey,
    pub refunded: u64,
    pub slashed: u64,
    /// POST-update provider Agent counters.
    pub score_failed: u64,
    pub slash_events: u32,
}

// ─── reject_job ──────────────────────────────────────────────────────────────
//
// Honest voluntary decline — no slash. Distinct from cancel_expired_job's
// Proposed->Expired branch, which fires only after the provider ghosts past
// the acceptance_deadline.

pub fn reject_job_handler(ctx: Context<RejectJob>, job_id: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.job_offer.status == JobStatus::Proposed,
        AutarkError::InvalidStatus
    );

    let amount = ctx.accounts.job_offer.amount;
    let consumer_key = ctx.accounts.job_offer.consumer;
    let job_bump = ctx.accounts.job_offer.bump;
    let job_key = ctx.accounts.job_offer.key();
    let signer_seeds: &[&[u8]] = &[SEED_JOB, consumer_key.as_ref(), job_id.as_ref(), &[job_bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.consumer_token_account.to_account_info(),
                authority: ctx.accounts.job_offer.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    ctx.accounts.job_offer.status = JobStatus::Rejected;

    emit!(JobRejected {
        job: job_key,
        provider: ctx.accounts.provider.key(),
        refunded: amount,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct RejectJob<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        has_one = provider @ AutarkError::NotProvider,
    )]
    pub job_offer: Box<Account<'info, JobOffer>>,

    #[account(mut, address = job_offer.escrow_vault)]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job_offer.consumer,
    )]
    pub consumer_token_account: Box<Account<'info, TokenAccount>>,

    #[account(address = job_offer.mint)]
    pub mint: Box<Account<'info, Mint>>,

    pub provider: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─── cancel_expired_job ──────────────────────────────────────────────────────
//
// Anyone may crank this. Two branches on the job's current status:
// (A) Proposed, past acceptance_deadline -> Expired. No earmark exists yet
//     (accept_job never ran), so the slash is SLASH_PCT_PROPOSED_EXPIRED bps
//     of the provider's TOTAL stake, not an earmark. open_jobs was never
//     incremented for this job, so it is not decremented here either.
// (B) Accepted, past delivery_deadline -> Abandoned. The earmark
//     (provider_stake_locked) already exists, so the slash is
//     SLASH_PCT_ABANDONED bps of THAT earmark — consistent with the
//     lost-challenge math in resolve_challenge, which is also earmark-based.
//
// Both branches reuse `slash_provider_stake` (see slashing.rs) for the actual
// CPI + bookkeeping — only the bps/base-amount formula differs per branch.

pub fn cancel_expired_job_handler(ctx: Context<CancelExpiredJob>, job_id: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let status = ctx.accounts.job_offer.status.clone();
    require!(
        status == JobStatus::Proposed || status == JobStatus::Accepted,
        AutarkError::InvalidStatus
    );

    let amount = ctx.accounts.job_offer.amount;
    let consumer_key = ctx.accounts.job_offer.consumer;
    let job_bump = ctx.accounts.job_offer.bump;
    let job_key = ctx.accounts.job_offer.key();
    let provider_key = ctx.accounts.job_offer.provider;
    let job_signer_seeds: &[&[u8]] =
        &[SEED_JOB, consumer_key.as_ref(), job_id.as_ref(), &[job_bump]];

    match status {
        JobStatus::Proposed => {
            require!(
                now > ctx.accounts.job_offer.acceptance_deadline,
                AutarkError::AcceptanceWindowNotExpired
            );

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.consumer_token_account.to_account_info(),
                        authority: ctx.accounts.job_offer.to_account_info(),
                    },
                    &[job_signer_seeds],
                ),
                amount,
            )?;

            // INTERPRETATION CALL: % of TOTAL stake, since no earmark exists
            // yet for a job that was never accepted. NOTE: this is a mild
            // grief vector — spam-propose tiny jobs at a competitor's agent
            // and they must actively reject_job each one or bleed 5% per
            // ignored proposal. Same class of griefability as the MAD path's
            // known issue; v2 hardening territory, not a demo blocker.
            let agent_stake = ctx.accounts.provider_agent.stake_amount;
            let slash_amount =
                (SLASH_PCT_PROPOSED_EXPIRED as u128 * agent_stake as u128 / 10_000u128) as u64;

            let slashed = slash_provider_stake(
                &ctx.accounts.token_program,
                &ctx.accounts.provider_stake_vault,
                &ctx.accounts.slashing_pool_vault,
                &mut ctx.accounts.provider_agent,
                &mut ctx.accounts.slashing_pool,
                slash_amount,
            )?;

            // Per the reputation table, Expired does NOT bump slash_events —
            // unlike Abandoned and lost-challenge. Deliberately inconsistent
            // with those two; flagging rather than silently "fixing" it.
            // open_jobs was never incremented for a Proposed job, so it must
            // not be decremented here.
            let provider_agent = &mut ctx.accounts.provider_agent;
            provider_agent.score_failed = provider_agent.score_failed.saturating_add(1);

            ctx.accounts.job_offer.status = JobStatus::Expired;

            emit!(JobExpired {
                job: job_key,
                provider: provider_key,
                refunded: amount,
                slashed,
                score_failed: ctx.accounts.provider_agent.score_failed,
            });
        }
        JobStatus::Accepted => {
            require!(
                now > ctx.accounts.job_offer.delivery_deadline,
                AutarkError::DeliveryWindowNotExpired
            );

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.consumer_token_account.to_account_info(),
                        authority: ctx.accounts.job_offer.to_account_info(),
                    },
                    &[job_signer_seeds],
                ),
                amount,
            )?;

            // INTERPRETATION CALL: % of the EARMARK (provider_stake_locked),
            // not total stake — keeps this consistent with resolve_challenge's
            // lost-challenge math (also earmark-based) and scales with job size.
            let provider_stake_locked = ctx.accounts.job_offer.provider_stake_locked;
            let slash_amount =
                (SLASH_PCT_ABANDONED as u128 * provider_stake_locked as u128 / 10_000u128) as u64;

            let slashed = slash_provider_stake(
                &ctx.accounts.token_program,
                &ctx.accounts.provider_stake_vault,
                &ctx.accounts.slashing_pool_vault,
                &mut ctx.accounts.provider_agent,
                &mut ctx.accounts.slashing_pool,
                slash_amount,
            )?;

            let provider_agent = &mut ctx.accounts.provider_agent;
            provider_agent.score_failed = provider_agent.score_failed.saturating_add(1);
            provider_agent.slash_events = provider_agent.slash_events.saturating_add(1);
            provider_agent.last_slash_slot = Clock::get()?.slot;
            provider_agent.open_jobs = provider_agent.open_jobs.saturating_sub(1);

            ctx.accounts.job_offer.status = JobStatus::Abandoned;
            ctx.accounts.job_offer.provider_stake_locked = 0;

            emit!(JobAbandoned {
                job: job_key,
                provider: provider_key,
                refunded: amount,
                slashed,
                score_failed: ctx.accounts.provider_agent.score_failed,
                slash_events: ctx.accounts.provider_agent.slash_events,
            });
        }
        _ => unreachable!("guarded by the status require! above"),
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct CancelExpiredJob<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
    )]
    pub job_offer: Box<Account<'info, JobOffer>>,

    #[account(mut, address = job_offer.escrow_vault)]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job_offer.consumer,
    )]
    pub consumer_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_AGENT, job_offer.provider.as_ref()],
        bump = provider_agent.bump,
    )]
    pub provider_agent: Box<Account<'info, Agent>>,

    #[account(mut, address = provider_agent.stake_vault)]
    pub provider_stake_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_SLASHING_POOL],
        bump = slashing_pool.bump,
    )]
    pub slashing_pool: Box<Account<'info, SlashingPool>>,

    #[account(mut, address = slashing_pool.vault)]
    pub slashing_pool_vault: Box<Account<'info, TokenAccount>>,

    #[account(address = job_offer.mint)]
    pub mint: Box<Account<'info, Mint>>,

    /// Anyone may crank this.
    pub cranker: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
