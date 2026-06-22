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
pub struct ReleaseEscrow<'info> {
    #[account(
        mut,
        seeds = [SEED_JOB, job_offer.consumer.as_ref(), job_id.as_ref()],
        bump = job_offer.bump,
        has_one = provider @ AgentBazaarError::InvalidProvider,
    )]
    pub job_offer: Account<'info, JobOffer>,

    /// The escrow ATA we created in propose_job. We pull funds from here.
    ///
    /// `associated_token::authority = job_offer`
    ///   — Anchor re-derives the ATA address from the job_offer PDA key and
    ///     the mint, then checks the passed account matches. This ensures we're
    ///     draining the correct escrow and not some other token account.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = job_offer,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Provider's USDC ATA — funds land here.
    /// Not created here: we require the provider to already have an ATA for
    /// this mint. The transfer CPI will fail with a clean error if they don't.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = provider,
    )]
    pub provider_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub provider: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,

    // AssociatedToken program required by the associated_token::* constraints.
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── Handler ─────────────────────────────────────────────────────────────────

pub fn handler(
    ctx: Context<ReleaseEscrow>,
    _job_id: [u8; 32],
    result_hash: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.job_offer.status == JobStatus::Accepted,
        AgentBazaarError::JobNotAccepted
    );

    // No delivery_deadline check here by design. The provider and consumer
    // race after delivery_deadline: provider releases → Settled,
    // consumer cancels → Expired. First one to land a tx wins.

    // ── PDA-as-signer pattern ────────────────────────────────────────────────
    //
    // The escrow ATA's authority field is set to job_offer.key() (the PDA).
    // Normal wallets sign by including their Ed25519 signature in the tx.
    // PDAs have no private key and cannot produce signatures. Instead, the
    // runtime grants signing authority to a PDA when the program provides the
    // seeds that hash to that PDA's address — this is what `new_with_signer`
    // does.
    //
    // The runtime verifies: sha256(seeds, program_id, "ProgramDerivedAddress")
    // == job_offer.key(). If yes, job_offer.key() is added to the signer set
    // for this CPI. The Token Program sees its authority in the signer set
    // and permits the transfer.
    //
    // We load the fields into locals first to avoid borrow conflicts:
    // the seeds slice holds references into these locals, and we also need
    // to pass job_offer.to_account_info() inside the same CpiContext.
    let consumer = ctx.accounts.job_offer.consumer;
    let job_id = ctx.accounts.job_offer.job_id;
    let bump = ctx.accounts.job_offer.bump;
    let offer_amount = ctx.accounts.job_offer.offer_amount;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.provider_token_account.to_account_info(),
                // The escrow ATA's authority is the job_offer PDA.
                // Passing it here + providing matching seeds below = PDA signs.
                authority: ctx.accounts.job_offer.to_account_info(),
            },
            &[&[SEED_JOB, consumer.as_ref(), &job_id, &[bump]]],
        ),
        offer_amount,
    )?;

    ctx.accounts.job_offer.status = JobStatus::Settled;
    ctx.accounts.job_offer.result_hash = Some(result_hash);

    Ok(())
}
