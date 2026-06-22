use anchor_lang::prelude::*;

use crate::{
    constants::{MAX_CAPABILITY_LEN, MAX_ENDPOINT_LEN, MAX_NAME_LEN, SEED_AGENT},
    error::AgentBazaarError,
    state::AgentAccount,
};

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    /// The agent PDA we're creating.
    ///
    /// `init`         — tells Anchor to call system_program::create_account.
    ///                  If this address already holds an account with our
    ///                  discriminator, the tx fails with ConstraintInit.
    ///                  That's the free double-registration guard.
    ///
    /// `payer = owner` — `owner` pays rent. Anchor enforces that `owner` is
    ///                   mutable and a signer (checked by the constraints on
    ///                   the `owner` field below).
    ///
    /// `space`        — exact byte count. Too small → init panics at runtime.
    ///                  Too large → wasted rent. We calculated 285 in state.rs.
    ///
    /// `seeds`        — defines which PDA address is valid here. The runtime
    ///                  derives [b"agent", owner.key()], finds the canonical
    ///                  bump, and rejects any account whose address doesn't
    ///                  match. An attacker cannot substitute a different PDA
    ///                  or a regular keypair account.
    ///
    /// `bump`         — Anchor finds the canonical bump and stores it in
    ///                  `ctx.bumps.agent`. We save this into the account so
    ///                  later instructions can sign as this PDA without calling
    ///                  find_program_address again (which costs compute units).
    #[account(
        init,
        payer = owner,
        space = AgentAccount::SPACE,
        seeds = [SEED_AGENT, owner.key().as_ref()],
        bump,
    )]
    pub agent: Account<'info, AgentAccount>,

    /// `mut`    — required because `owner` pays for the account creation
    ///            (lamports leave this account). Anchor checks mutability.
    ///
    /// `Signer` — enforces that the transaction carries a valid Ed25519
    ///            signature from this key. Without this, anyone could pass
    ///            any pubkey as `owner` and register an agent under a key
    ///            they don't control.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Anchor requires `System` to be present whenever `init` is used,
    /// because it CPIs to system_program::create_account under the hood.
    pub system_program: Program<'info, System>,
}

// ─── Handler ─────────────────────────────────────────────────────────────────

pub fn handler(
    ctx: Context<RegisterAgent>,
    name: String,
    capability: String,
    endpoint: String,
    price_hint: u64,
) -> Result<()> {
    // Validate string lengths BEFORE writing to the account.
    // We can't enforce these in the #[account] constraint because
    // `init` allocates space = AgentAccount::SPACE which is sized for
    // the *maximum* string. Shorter strings are fine; longer ones would
    // write past the allocation and corrupt the account.
    require!(name.len() <= MAX_NAME_LEN, AgentBazaarError::NameTooLong);
    require!(
        capability.len() <= MAX_CAPABILITY_LEN,
        AgentBazaarError::CapabilityTooLong
    );
    require!(
        endpoint.len() <= MAX_ENDPOINT_LEN,
        AgentBazaarError::EndpointTooLong
    );

    let agent = &mut ctx.accounts.agent;
    agent.owner = ctx.accounts.owner.key();
    agent.name = name;
    agent.capability = capability;
    agent.endpoint = endpoint;
    agent.price_hint = price_hint;
    // ctx.bumps.agent is the canonical bump Anchor found during constraint
    // validation. Storing it now means we never call find_program_address
    // again in other instructions — we use this bump directly in seeds.
    agent.bump = ctx.bumps.agent;

    Ok(())
}
