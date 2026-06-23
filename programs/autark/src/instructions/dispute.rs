use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{
    SEED_AGENT, SEED_CHALLENGE, SEED_JOB, SEED_SLASHING_POOL, SLASH_PCT_LOST_CHALLENGE,
};
use crate::errors::AutarkError;
use crate::instructions::slashing::slash_provider_stake;
use crate::state::{Agent, Challenge, ChallengeState, JobOffer, JobStatus, SlashingPool};

// ─── Events ──────────────────────────────────────────────────────────────────
//
// Emitted on every step of the dispute path so the demo-day stage UI can
// render the slash and the reputation counters moving in real time.

#[event]
pub struct ChallengeOpened {
    pub job: Pubkey,
    pub challenger: Pubkey,
    pub defender: Pubkey,
    pub amount: u64,
    pub defense_deadline: i64,
}

#[event]
pub struct ChallengeDefended {
    pub job: Pubkey,
    pub defender: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ChallengeResolved {
    pub job: Pubkey,
    pub defended: bool,
    pub consumer_refund: u64,
    pub provider_payout: u64,
    pub slashed: u64,
    /// POST-update provider Agent counters — the dashboard reads the slash
    /// straight off this event, no re-fetch.
    pub provider_score_completed: u64,
    pub provider_score_volume: u64,
    pub provider_score_failed: u64,
}

// ─── challenge_settlement ────────────────────────────────────────────────────

pub fn challenge_settlement_handler(
    ctx: Context<ChallengeSettlement>,
    _job_id: [u8; 32],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let amount = ctx.accounts.job_offer.amount;
    let provider = ctx.accounts.job_offer.provider;
    let mint = ctx.accounts.job_offer.mint;

    require!(
        ctx.accounts.job_offer.status == JobStatus::SettlementPending,
        AutarkError::InvalidStatus
    );
    let window_end = ctx
        .accounts
        .job_offer
        .settlement_pending_at
        .ok_or(AutarkError::InvalidStatus)?
        .saturating_add(ctx.accounts.job_offer.challenge_window_seconds as i64);
    require!(now <= window_end, AutarkError::ChallengeWindowClosed);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.consumer_token_account.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.consumer.to_account_info(),
            },
        ),
        amount,
    )?;

    let job_key = ctx.accounts.job_offer.key();
    // Per-job param, like challenge_window_seconds — DEFENSE_WINDOW (the
    // hardcoded 48h const) is only the recommended default a caller/SDK
    // passes for production; it is no longer read here.
    let defense_deadline =
        now.saturating_add(ctx.accounts.job_offer.defense_window_seconds as i64);

    let challenge = &mut ctx.accounts.challenge;
    challenge.job = job_key;
    challenge.challenger = ctx.accounts.consumer.key();
    challenge.defender = provider;
    challenge.mint = mint;
    challenge.stake_vault = ctx.accounts.stake_vault.key();
    challenge.challenge_stake = amount;
    challenge.defense_stake = 0;
    challenge.state = ChallengeState::Open;
    challenge.opened_at = now;
    challenge.defense_deadline = defense_deadline;
    challenge.defended_at = 0;
    challenge.bump = ctx.bumps.challenge;

    ctx.accounts.job_offer.status = JobStatus::Challenged;

    emit!(ChallengeOpened {
        job: job_key,
        challenger: ctx.accounts.consumer.key(),
        defender: provider,
        amount,
        defense_deadline,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct ChallengeSettlement<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        has_one = consumer @ AutarkError::NotConsumer,
    )]
    pub job_offer: Box<Account<'info, JobOffer>>,

    #[account(
        init,
        payer = consumer,
        space = 8 + Challenge::INIT_SPACE,
        seeds = [SEED_CHALLENGE, job_offer.key().as_ref()],
        bump,
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    #[account(
        init,
        payer = consumer,
        associated_token::mint = mint,
        associated_token::authority = challenge,
    )]
    pub stake_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = consumer,
    )]
    pub consumer_token_account: Box<Account<'info, TokenAccount>>,

    #[account(address = job_offer.mint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub consumer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── defend_challenge ────────────────────────────────────────────────────────

pub fn defend_challenge_handler(ctx: Context<DefendChallenge>, _job_id: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.job_offer.status == JobStatus::Challenged,
        AutarkError::InvalidStatus
    );
    require!(
        ctx.accounts.challenge.state == ChallengeState::Open,
        AutarkError::InvalidStatus
    );
    require!(
        now <= ctx.accounts.challenge.defense_deadline,
        AutarkError::DefenseDeadlinePassed
    );

    let amount = ctx.accounts.job_offer.amount;
    let job_key = ctx.accounts.job_offer.key();

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.provider_token_account.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.provider.to_account_info(),
            },
        ),
        amount,
    )?;

    let challenge = &mut ctx.accounts.challenge;
    challenge.defense_stake = amount;
    challenge.defended_at = now;
    challenge.state = ChallengeState::Defended;

    emit!(ChallengeDefended {
        job: job_key,
        defender: ctx.accounts.provider.key(),
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct DefendChallenge<'info> {
    #[account(
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        has_one = provider @ AutarkError::NotProvider,
    )]
    pub job_offer: Box<Account<'info, JobOffer>>,

    #[account(
        mut,
        seeds = [SEED_CHALLENGE, job_offer.key().as_ref()],
        bump = challenge.bump,
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    #[account(mut, address = challenge.stake_vault)]
    pub stake_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = provider,
    )]
    pub provider_token_account: Box<Account<'info, TokenAccount>>,

    #[account(address = job_offer.mint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub provider: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─── resolve_challenge ───────────────────────────────────────────────────────
//
// Anyone may crank this once defense_deadline has passed. Two branches:
// (A) never defended -> provider loses: full refund to consumer + auto-slash
//     drawn from the provider's STAKED vault (Agent.stake_vault) — a token
//     source distinct from the challenge/defense stakes below.
// (B) defended (MAD) -> mutual destruction: escrow split 50/50, both
//     challenge/defense stakes (which came from each party's own wallet, NOT
//     the provider's staked vault) are burned to the slashing pool.
// Both branches terminate in JobStatus::Burned and close the Challenge PDA.

#[allow(unused_assignments)]
pub fn resolve_challenge_handler(ctx: Context<ResolveChallenge>, job_id: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.job_offer.status == JobStatus::Challenged,
        AutarkError::InvalidStatus
    );
    require!(
        now > ctx.accounts.challenge.defense_deadline,
        AutarkError::DefenseWindowNotElapsed
    );

    let job_key = ctx.accounts.job_offer.key();
    let consumer_key = ctx.accounts.job_offer.consumer;
    let job_bump = ctx.accounts.job_offer.bump;
    let job_amount = ctx.accounts.job_offer.amount;
    let job_signer_seeds: &[&[u8]] =
        &[SEED_JOB, consumer_key.as_ref(), job_id.as_ref(), &[job_bump]];

    let defended = ctx.accounts.challenge.state == ChallengeState::Defended;
    let challenge_stake = ctx.accounts.challenge.challenge_stake;
    let defense_stake = ctx.accounts.challenge.defense_stake;
    let challenge_bump = ctx.accounts.challenge.bump;
    let challenge_signer_seeds: &[&[u8]] = &[SEED_CHALLENGE, job_key.as_ref(), &[challenge_bump]];

    let mut consumer_refund: u64 = 0;
    let mut provider_payout: u64 = 0;
    let mut slashed: u64 = 0;

    if !defended {
        // (A) provider never defended.

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.challenge_stake_vault.to_account_info(),
                    to: ctx.accounts.consumer_token_account.to_account_info(),
                    authority: ctx.accounts.challenge.to_account_info(),
                },
                &[challenge_signer_seeds],
            ),
            challenge_stake,
        )?;

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
            job_amount,
        )?;
        consumer_refund = challenge_stake.saturating_add(job_amount);

        let provider_stake_locked = ctx.accounts.job_offer.provider_stake_locked;
        let agent_stake = ctx.accounts.provider_agent.stake_amount;
        let earmarked = std::cmp::min(provider_stake_locked, agent_stake);
        // never underflow: extra is capped by whatever stake remains above
        // the earmarked portion.
        let extra = std::cmp::min(
            (SLASH_PCT_LOST_CHALLENGE as u128 * provider_stake_locked as u128 / 10_000u128)
                as u64,
            agent_stake.saturating_sub(earmarked),
        );
        let total_slashed = earmarked.saturating_add(extra);

        slashed = slash_provider_stake(
            &ctx.accounts.token_program,
            &ctx.accounts.provider_stake_vault,
            &ctx.accounts.slashing_pool_vault,
            &mut ctx.accounts.provider_agent,
            &mut ctx.accounts.slashing_pool,
            total_slashed,
        )?;

        let provider_agent = &mut ctx.accounts.provider_agent;
        provider_agent.score_failed = provider_agent.score_failed.saturating_add(1);
        provider_agent.slash_events = provider_agent.slash_events.saturating_add(1);
        provider_agent.last_slash_slot = Clock::get()?.slot;
        provider_agent.open_jobs = provider_agent.open_jobs.saturating_sub(1);
    } else {
        // (B) defended — mutual assured destruction. Split principal, burn
        // both stakes. No additional slash on the provider's staked vault:
        // the defense stake already came out of the provider's own wallet.

        let half = job_amount / 2;
        let other_half = job_amount - half;

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
            half,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.provider_token_account.to_account_info(),
                    authority: ctx.accounts.job_offer.to_account_info(),
                },
                &[job_signer_seeds],
            ),
            other_half,
        )?;
        consumer_refund = half;
        provider_payout = other_half;

        let total_burned = challenge_stake.saturating_add(defense_stake);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.challenge_stake_vault.to_account_info(),
                    to: ctx.accounts.slashing_pool_vault.to_account_info(),
                    authority: ctx.accounts.challenge.to_account_info(),
                },
                &[challenge_signer_seeds],
            ),
            total_burned,
        )?;
        slashed = total_burned;

        let slashing_pool = &mut ctx.accounts.slashing_pool;
        slashing_pool.total_slashed = slashing_pool.total_slashed.saturating_add(total_burned);

        let provider_agent = &mut ctx.accounts.provider_agent;
        provider_agent.score_failed = provider_agent.score_failed.saturating_add(1);
        provider_agent.open_jobs = provider_agent.open_jobs.saturating_sub(1);

        // The consumer is any wallet — not necessarily a registered Agent.
        // Only ding score_failed if a consumer Agent account was actually
        // passed in; otherwise skip. Deliberate asymmetry: providers are
        // always registered Agents, consumers are not.
        if let Some(consumer_agent) = ctx.accounts.consumer_agent.as_mut() {
            consumer_agent.score_failed = consumer_agent.score_failed.saturating_add(1);
        }
    }

    ctx.accounts.job_offer.status = JobStatus::Burned;
    ctx.accounts.job_offer.provider_stake_locked = 0;

    emit!(ChallengeResolved {
        job: job_key,
        defended,
        consumer_refund,
        provider_payout,
        slashed,
        provider_score_completed: ctx.accounts.provider_agent.score_completed,
        provider_score_volume: ctx.accounts.provider_agent.score_volume,
        provider_score_failed: ctx.accounts.provider_agent.score_failed,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct ResolveChallenge<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
    )]
    pub job_offer: Box<Account<'info, JobOffer>>,

    #[account(
        mut,
        close = challenger,
        seeds = [SEED_CHALLENGE, job_offer.key().as_ref()],
        bump = challenge.bump,
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    /// CHECK: rent destination for the closed Challenge PDA; authenticity
    /// enforced by the `address = challenge.challenger` constraint.
    #[account(mut, address = challenge.challenger)]
    pub challenger: UncheckedAccount<'info>,

    #[account(mut, address = job_offer.escrow_vault)]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, address = challenge.stake_vault)]
    pub challenge_stake_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_SLASHING_POOL],
        bump = slashing_pool.bump,
    )]
    pub slashing_pool: Box<Account<'info, SlashingPool>>,

    #[account(mut, address = slashing_pool.vault)]
    pub slashing_pool_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_AGENT, job_offer.provider.as_ref()],
        bump = provider_agent.bump,
    )]
    pub provider_agent: Box<Account<'info, Agent>>,

    #[account(mut, address = provider_agent.stake_vault)]
    pub provider_stake_vault: Box<Account<'info, TokenAccount>>,

    /// Optional: only present if the consumer happens to also be a
    /// registered Agent. See the handler's defended branch.
    pub consumer_agent: Option<Box<Account<'info, Agent>>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job_offer.consumer,
    )]
    pub consumer_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job_offer.provider,
    )]
    pub provider_token_account: Box<Account<'info, TokenAccount>>,

    #[account(address = job_offer.mint)]
    pub mint: Box<Account<'info, Mint>>,

    /// Anyone may crank this once defense_deadline has passed.
    pub cranker: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
