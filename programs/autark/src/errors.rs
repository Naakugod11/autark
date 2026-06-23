use anchor_lang::prelude::*;

#[error_code]
pub enum AutarkError {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,

    #[msg("Account is not in the required status for this action")]
    InvalidStatus,

    #[msg("Stake amount is below the required minimum")]
    StakeTooLow,

    #[msg("Deadline has passed")]
    DeadlinePassed,

    #[msg("Mint is not on the whitelist")]
    MintNotWhitelisted,

    #[msg("Mint is already on the whitelist")]
    MintAlreadyWhitelisted,

    #[msg("Mint whitelist is full")]
    MintWhitelistFull,

    #[msg("Amount must be greater than zero")]
    AmountZero,

    #[msg("Deadlines invalid: acceptance must be before delivery")]
    InvalidDeadlines,

    #[msg("Signer is not the provider for this job")]
    NotProvider,

    #[msg("Agent has open jobs and cannot withdraw stake")]
    AgentHasOpenJobs,

    #[msg("Resulting stake would fall below the required minimum")]
    StakeBelowMinimum,

    #[msg("Acceptance deadline has not yet passed")]
    AcceptanceWindowNotExpired,

    #[msg("Challenge window has not yet elapsed")]
    ChallengeWindowNotElapsed,

    #[msg("Insufficient funds for this transfer")]
    InsufficientFunds,

    #[msg("Agent has too many capability tags")]
    TooManyCapabilities,

    #[msg("Capability tag exceeds the maximum length")]
    CapabilityTooLong,

    #[msg("Endpoint URL exceeds the maximum length")]
    EndpointTooLong,

    #[msg("Bid price exceeds the bounty's max amount")]
    BidPriceTooHigh,

    #[msg("Bidder's completed-job reputation is below the bounty's minimum")]
    ReputationTooLow,

    #[msg("Bid does not belong to this bounty")]
    BidNotForBounty,

    #[msg("Signer is not the consumer for this job")]
    NotConsumer,

    #[msg("Challenge window has already closed — crank claim_settlement instead")]
    ChallengeWindowClosed,

    #[msg("Defense deadline has already passed")]
    DefenseDeadlinePassed,

    #[msg("Defense window has not yet elapsed")]
    DefenseWindowNotElapsed,
}
