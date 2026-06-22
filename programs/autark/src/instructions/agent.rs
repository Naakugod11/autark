use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{
    MAX_CAPABILITIES, MAX_CAPABILITY_LEN, MAX_ENDPOINT_LEN, MIN_STAKE_AMOUNT, SEED_AGENT,
    SEED_MINT_WHITELIST,
};
use crate::errors::AutarkError;
use crate::state::{Agent, MintWhitelist};

fn validate_capabilities(capabilities: &[String], endpoint_url: &str) -> Result<()> {
    require!(
        capabilities.len() <= MAX_CAPABILITIES,
        AutarkError::TooManyCapabilities
    );
    for capability in capabilities {
        require!(
            capability.len() <= MAX_CAPABILITY_LEN,
            AutarkError::CapabilityTooLong
        );
    }
    require!(
        endpoint_url.len() <= MAX_ENDPOINT_LEN,
        AutarkError::EndpointTooLong
    );
    Ok(())
}

// ─── register_agent ──────────────────────────────────────────────────────────

pub fn register_agent_handler(
    ctx: Context<RegisterAgent>,
    capabilities: Vec<String>,
    endpoint_url: String,
    initial_stake: u64,
) -> Result<()> {
    validate_capabilities(&capabilities, &endpoint_url)?;
    require!(initial_stake >= MIN_STAKE_AMOUNT, AutarkError::StakeTooLow);
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
                from: ctx.accounts.owner_token_account.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        initial_stake,
    )?;

    let agent = &mut ctx.accounts.agent;
    agent.owner = ctx.accounts.owner.key();
    agent.capabilities = capabilities;
    agent.endpoint_url = endpoint_url;
    agent.stake_amount = initial_stake;
    agent.stake_vault = ctx.accounts.stake_vault.key();
    agent.score_completed = 0;
    agent.score_failed = 0;
    agent.score_volume = 0;
    agent.slash_events = 0;
    agent.last_slash_slot = 0;
    agent.created_at = Clock::get()?.unix_timestamp;
    agent.bump = ctx.bumps.agent;
    agent.open_jobs = 0;

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Agent::INIT_SPACE,
        seeds = [SEED_AGENT, owner.key().as_ref()],
        bump,
    )]
    pub agent: Account<'info, Agent>,

    #[account(seeds = [SEED_MINT_WHITELIST], bump = mint_whitelist.bump)]
    pub mint_whitelist: Account<'info, MintWhitelist>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = agent,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── update_agent_capabilities ───────────────────────────────────────────────

pub fn update_agent_capabilities_handler(
    ctx: Context<UpdateAgentCapabilities>,
    new_capabilities: Vec<String>,
    new_endpoint_url: String,
) -> Result<()> {
    validate_capabilities(&new_capabilities, &new_endpoint_url)?;
    let agent = &mut ctx.accounts.agent;
    agent.capabilities = new_capabilities;
    agent.endpoint_url = new_endpoint_url;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateAgentCapabilities<'info> {
    #[account(
        mut,
        seeds = [SEED_AGENT, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner,
    )]
    pub agent: Account<'info, Agent>,

    pub owner: Signer<'info>,
}

// ─── stake_deposit ───────────────────────────────────────────────────────────

pub fn stake_deposit_handler(ctx: Context<StakeDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, AutarkError::AmountZero);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.owner_token_account.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    ctx.accounts.agent.stake_amount = ctx.accounts.agent.stake_amount.saturating_add(amount);
    Ok(())
}

#[derive(Accounts)]
pub struct StakeDeposit<'info> {
    #[account(
        mut,
        seeds = [SEED_AGENT, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner,
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut, address = agent.stake_vault)]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─── stake_withdraw ──────────────────────────────────────────────────────────

pub fn stake_withdraw_handler(ctx: Context<StakeWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, AutarkError::AmountZero);

    let agent = &ctx.accounts.agent;
    require!(agent.open_jobs == 0, AutarkError::AgentHasOpenJobs);
    let remaining = agent
        .stake_amount
        .checked_sub(amount)
        .ok_or(AutarkError::InsufficientFunds)?;
    require!(remaining >= MIN_STAKE_AMOUNT, AutarkError::StakeBelowMinimum);

    let owner_key = agent.owner;
    let bump = agent.bump;
    let signer_seeds: &[&[u8]] = &[SEED_AGENT, owner_key.as_ref(), &[bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.stake_vault.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(),
                authority: ctx.accounts.agent.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    ctx.accounts.agent.stake_amount = remaining;
    Ok(())
}

#[derive(Accounts)]
pub struct StakeWithdraw<'info> {
    #[account(
        mut,
        seeds = [SEED_AGENT, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner,
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut, address = agent.stake_vault)]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
