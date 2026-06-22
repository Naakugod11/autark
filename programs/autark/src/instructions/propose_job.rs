use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    constants::{SEED_AGENT, SEED_JOB},
    error::AgentBazaarError,
    state::{AgentAccount, JobOffer, JobStatus},
};

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
// ^^^ Makes `job_id` available inside #[account(...)] constraint expressions
// so we can use it in the seeds derivation below. Only args used in
// constraints need to be listed; offer_amount and expiry are not.
pub struct ProposeJob<'info> {
    /// The job offer PDA we're creating.
    ///
    /// `seeds = [SEED_JOB, consumer.key(), job_id]`
    ///   — The consumer key makes this PDA unique per consumer.
    ///   — The job_id makes it unique per job within that consumer.
    ///   — Together they enforce uniqueness: two identical job_ids from
    ///     the same consumer map to the same PDA, so `init` will reject
    ///     the second one (ConstraintInit). No separate uniqueness check
    ///     needed in the handler.
    #[account(
        init,
        payer = consumer,
        space = JobOffer::SPACE,
        seeds = [SEED_JOB, consumer.key().as_ref(), job_id.as_ref()],
        bump,
    )]
    pub job_offer: Account<'info, JobOffer>,

    /// The escrow token account. This is the Associated Token Account (ATA)
    /// whose authority is the `job_offer` PDA — not the consumer, not the
    /// program. Only the program can sign as `job_offer` (via PDA seeds),
    /// so only the program can move funds out of this account.
    ///
    /// `init` — safe to use (not init_if_needed) because the `job_offer`
    ///   PDA itself was just created in this tx via `init` above. A PDA
    ///   that never existed cannot have an ATA that already exists.
    ///
    /// `associated_token::authority = job_offer`
    ///   — Anchor derives the ATA address as PDA([job_offer.key(), token_program.key(),
    ///     usdc_mint.key()], associated_token_program) and verifies the account
    ///     at that address matches. This is what makes the escrow self-custodial:
    ///     the authority is a PDA the program controls, not a human wallet.
    ///
    /// `associated_token::mint = usdc_mint`
    ///   — Anchor checks that the ATA's stored mint field equals usdc_mint.key().
    ///     Without this, a caller could pass a pre-existing ATA for a different
    ///     mint and the escrow would hold the wrong token.
    #[account(
        init,
        payer = consumer,
        associated_token::mint = usdc_mint,
        associated_token::authority = job_offer,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// The provider's registered agent PDA. Loading it as Account<'info, AgentAccount>
    /// (not AccountInfo) causes Anchor to:
    ///   1. Verify the account is owned by our program (discriminator check).
    ///   2. Deserialize it, giving us access to provider_agent.owner.
    ///
    /// The seeds constraint verifies this is the canonical agent PDA for
    /// whoever is stored as provider_agent.owner. This prevents passing a
    /// hand-crafted account that looks like an AgentAccount but wasn't
    /// registered through register_agent.
    #[account(
        seeds = [SEED_AGENT, provider_agent.owner.as_ref()],
        bump = provider_agent.bump,
    )]
    pub provider_agent: Account<'info, AgentAccount>,

    /// Consumer's USDC token account. Funds will be pulled from here.
    ///
    /// `mut` — required because we're debiting it in the CPI.
    ///
    /// `associated_token::mint = usdc_mint`
    ///   — Verifies this ATA is for the correct mint. If the consumer passed
    ///     their own ATA for a different token, this constraint rejects it
    ///     before the CPI, giving a clear error instead of a CPI failure.
    ///
    /// `associated_token::authority = consumer`
    ///   — Verifies this is the consumer's ATA (derived from their key).
    ///     Prevents a caller from passing someone else's token account as
    ///     the source (the transfer would then fail in the CPI, but it's
    ///     better to catch it here).
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = consumer,
    )]
    pub consumer_token_account: Account<'info, TokenAccount>,

    /// `mut` — consumer pays rent for job_offer and escrow_token_account.
    /// `Signer` — consumer authorizes both the account creations (rent)
    ///   and the token transfer from their ATA.
    #[account(mut)]
    pub consumer: Signer<'info>,

    /// No address constraint — we support any SPL mint (devnet fake USDC
    /// or real USDC). Security: both ATAs must be for this same mint
    /// (enforced above). The provider should verify the mint off-chain
    /// before calling accept_job.
    ///
    /// Account<'info, Mint> (not AccountInfo) — Anchor verifies the account
    /// is owned by the Token Program before deserializing. A non-mint
    /// account fails here, not silently in the CPI.
    pub usdc_mint: Account<'info, Mint>,

    /// Required for the token::transfer CPI.
    pub token_program: Program<'info, Token>,

    /// Required for creating the escrow ATA via the `init` +
    /// `associated_token::*` constraints above.
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// Required for the two `init` account creations (job_offer and
    /// escrow_token_account both need system_program::create_account).
    pub system_program: Program<'info, System>,
}

// ─── Handler ─────────────────────────────────────────────────────────────────

pub fn handler(
    ctx: Context<ProposeJob>,
    job_id: [u8; 32],
    offer_amount: u64,
    acceptance_deadline: i64,
    delivery_deadline: i64,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(offer_amount > 0, AgentBazaarError::ZeroAmount);
    // Both deadline checks collapsed into one error: acceptance must be in
    // the future, and delivery must come after acceptance.
    require!(
        acceptance_deadline > clock.unix_timestamp
            && delivery_deadline > acceptance_deadline,
        AgentBazaarError::InvalidDeadlines
    );

    // Explicit balance check for a clean error message. The CPI would also
    // fail here, but with a generic SPL token error code, not InsufficientFunds.
    require!(
        ctx.accounts.consumer_token_account.amount >= offer_amount,
        AgentBazaarError::InsufficientFunds
    );

    // ── CPI: lock funds in escrow ────────────────────────────────────────────
    //
    // Consumer is the signer of this tx. The Token Program allows a transfer
    // FROM a token account when the authority field matches a tx signer.
    // No separate `approve` call needed.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.consumer_token_account.to_account_info(),
                to: ctx.accounts.escrow_token_account.to_account_info(),
                authority: ctx.accounts.consumer.to_account_info(),
            },
        ),
        offer_amount,
    )?;

    // ── Write job offer state ────────────────────────────────────────────────
    let job_offer = &mut ctx.accounts.job_offer;
    job_offer.consumer = ctx.accounts.consumer.key();
    // Store provider's WALLET pubkey (agent.owner), not the agent PDA key.
    // has_one = provider in downstream instructions checks signer.key() against this.
    job_offer.provider = ctx.accounts.provider_agent.owner;
    job_offer.job_id = job_id;
    job_offer.offer_amount = offer_amount;
    job_offer.acceptance_deadline = acceptance_deadline;
    job_offer.delivery_deadline = delivery_deadline;
    job_offer.status = JobStatus::Proposed;
    job_offer.result_hash = None;
    job_offer.bump = ctx.bumps.job_offer;

    Ok(())
}
