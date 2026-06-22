use anchor_lang::prelude::*;

#[error_code]
pub enum AgentBazaarError {
    // ── Registration ──────────────────────────────────────────────────────────
    #[msg("Agent name exceeds 32 characters")]
    NameTooLong,

    #[msg("Capability string exceeds 64 characters")]
    CapabilityTooLong,

    #[msg("Endpoint string exceeds 128 characters")]
    EndpointTooLong,

    // ── Offer validation ──────────────────────────────────────────────────────
    #[msg("Offer amount must be greater than zero")]
    ZeroAmount,

    /// Fired when acceptance_deadline <= now OR delivery_deadline <= acceptance_deadline.
    #[msg("Deadlines invalid: acceptance must be in the future, delivery must be after acceptance")]
    InvalidDeadlines,

    // ── Authorization ─────────────────────────────────────────────────────────
    #[msg("Signer is not the provider for this job")]
    InvalidProvider,

    #[msg("Signer is not the consumer for this job")]
    InvalidConsumer,

    // ── Status transitions ────────────────────────────────────────────────────
    #[msg("Job is not in Proposed state")]
    JobNotProposed,

    #[msg("Job is not in Accepted state")]
    JobNotAccepted,

    /// Fired by cancel_expired_job when the job is in a terminal state
    /// (Settled, Rejected, or already Expired) that cannot be cancelled.
    #[msg("Job is not in a cancellable state (must be Proposed or Accepted)")]
    JobNotCancellable,

    // ── Timing ────────────────────────────────────────────────────────────────
    #[msg("Job offer deadline has passed")]
    JobExpired,

    #[msg("Deadline has not passed yet")]
    JobNotExpired,

    // ── Token ─────────────────────────────────────────────────────────────────
    #[msg("Consumer has insufficient USDC balance")]
    InsufficientFunds,
}
