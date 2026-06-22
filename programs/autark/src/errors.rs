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
}
