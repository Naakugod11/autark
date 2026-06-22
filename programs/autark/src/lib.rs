pub mod constants;
pub mod errors;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use errors::*;
pub use state::*;

declare_id!("FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy");

#[program]
pub mod autark {}
