use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::SEED_AGENT;
use crate::state::{Agent, SlashingPool};

/// Shared staked-vault slash primitive: moves `amount` (capped to whatever
/// the agent currently has staked) from the provider Agent's own stake_vault
/// to the SlashingPool vault, signed by the Agent PDA, and updates both
/// accounts' bookkeeping. Returns the amount actually slashed.
///
/// Callers compute `amount` using whatever bps/earmark formula fits their
/// narrative (lost-challenge, abandoned, expired) — this function only owns
/// the CPI + state-update mechanics, so that logic isn't duplicated across
/// resolve_challenge and cancel_expired_job.
pub fn slash_provider_stake<'info>(
    token_program: &Program<'info, Token>,
    provider_stake_vault: &Account<'info, TokenAccount>,
    slashing_pool_vault: &Account<'info, TokenAccount>,
    provider_agent: &mut Account<'info, Agent>,
    slashing_pool: &mut Account<'info, SlashingPool>,
    amount: u64,
) -> Result<u64> {
    let capped = std::cmp::min(amount, provider_agent.stake_amount);

    if capped > 0 {
        let agent_owner = provider_agent.owner;
        let agent_bump = provider_agent.bump;
        let signer_seeds: &[&[u8]] = &[SEED_AGENT, agent_owner.as_ref(), &[agent_bump]];

        token::transfer(
            CpiContext::new_with_signer(
                token_program.key(),
                Transfer {
                    from: provider_stake_vault.to_account_info(),
                    to: slashing_pool_vault.to_account_info(),
                    authority: provider_agent.to_account_info(),
                },
                &[signer_seeds],
            ),
            capped,
        )?;
    }

    provider_agent.stake_amount = provider_agent.stake_amount.saturating_sub(capped);
    slashing_pool.total_slashed = slashing_pool.total_slashed.saturating_add(capped);

    Ok(capped)
}
