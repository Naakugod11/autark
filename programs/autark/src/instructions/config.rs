use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{MAX_WHITELISTED_MINTS, SEED_MINT_WHITELIST, SEED_SLASHING_POOL};
use crate::errors::AutarkError;
use crate::state::{MintWhitelist, SlashingPool};

// ─── init_mint_whitelist ─────────────────────────────────────────────────────

pub fn init_mint_whitelist_handler(ctx: Context<InitMintWhitelist>) -> Result<()> {
    let mint_whitelist = &mut ctx.accounts.mint_whitelist;
    mint_whitelist.authority = ctx.accounts.authority.key();
    mint_whitelist.mints = Vec::new();
    mint_whitelist.bump = ctx.bumps.mint_whitelist;
    Ok(())
}

#[derive(Accounts)]
pub struct InitMintWhitelist<'info> {
    /// Whoever calls this becomes the deployer authority for all config.
    #[account(
        init,
        payer = authority,
        space = 8 + MintWhitelist::INIT_SPACE,
        seeds = [SEED_MINT_WHITELIST],
        bump,
    )]
    pub mint_whitelist: Account<'info, MintWhitelist>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ─── add_whitelisted_mint ────────────────────────────────────────────────────

pub fn add_whitelisted_mint_handler(ctx: Context<AddWhitelistedMint>, mint: Pubkey) -> Result<()> {
    let mint_whitelist = &mut ctx.accounts.mint_whitelist;
    require!(
        !mint_whitelist.mints.contains(&mint),
        AutarkError::MintAlreadyWhitelisted
    );
    require!(
        mint_whitelist.mints.len() < MAX_WHITELISTED_MINTS,
        AutarkError::MintWhitelistFull
    );
    mint_whitelist.mints.push(mint);
    Ok(())
}

#[derive(Accounts)]
pub struct AddWhitelistedMint<'info> {
    #[account(
        mut,
        seeds = [SEED_MINT_WHITELIST],
        bump = mint_whitelist.bump,
        has_one = authority,
    )]
    pub mint_whitelist: Account<'info, MintWhitelist>,

    pub authority: Signer<'info>,
}

// ─── init_slashing_pool ──────────────────────────────────────────────────────

pub fn init_slashing_pool_handler(ctx: Context<InitSlashingPool>) -> Result<()> {
    let slashing_pool = &mut ctx.accounts.slashing_pool;
    slashing_pool.mint = ctx.accounts.mint.key();
    slashing_pool.vault = ctx.accounts.vault.key();
    slashing_pool.total_slashed = 0;
    slashing_pool.bump = ctx.bumps.slashing_pool;
    Ok(())
}

#[derive(Accounts)]
pub struct InitSlashingPool<'info> {
    /// Same deployer authority as the mint whitelist gates this too.
    #[account(
        seeds = [SEED_MINT_WHITELIST],
        bump = mint_whitelist.bump,
        has_one = authority,
    )]
    pub mint_whitelist: Account<'info, MintWhitelist>,

    /// Singleton — v1 is USDC-only, so the program supports exactly one pool.
    #[account(
        init,
        payer = authority,
        space = 8 + SlashingPool::INIT_SPACE,
        seeds = [SEED_SLASHING_POOL],
        bump,
    )]
    pub slashing_pool: Account<'info, SlashingPool>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = slashing_pool,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
