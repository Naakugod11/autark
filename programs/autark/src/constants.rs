use anchor_lang::prelude::*;

pub const SEED_AGENT: &[u8] = b"agent";
pub const SEED_JOB: &[u8] = b"job";

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_CAPABILITY_LEN: usize = 64;
pub const MAX_ENDPOINT_LEN: usize = 128;
