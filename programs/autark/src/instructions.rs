pub mod accept_job;
pub mod cancel_expired_job;
pub mod propose_job;
pub mod register_agent;
pub mod reject_job;
pub mod release_escrow;

// Glob re-exports are load-bearing: Anchor's #[program] macro generates
// `__client_accounts_<Struct>` modules inside each #[derive(Accounts)] module
// and imports them via `crate::*`. Named-only re-exports omit those generated
// modules and produce E0432 at the #[program] expansion site.
//
// The `handler` name collision across modules is the only ambiguous name; every
// other public item (AcceptJob, ProposeJob, …, __client_accounts_*) is unique.
// Renaming handler to the instruction name collides with names the #[program]
// macro itself generates at the crate root — so `handler` is the right name and
// the allow below is the correct suppression point.
#[allow(ambiguous_glob_reexports)]
pub use accept_job::*;
#[allow(ambiguous_glob_reexports)]
pub use cancel_expired_job::*;
#[allow(ambiguous_glob_reexports)]
pub use propose_job::*;
#[allow(ambiguous_glob_reexports)]
pub use register_agent::*;
#[allow(ambiguous_glob_reexports)]
pub use reject_job::*;
#[allow(ambiguous_glob_reexports)]
pub use release_escrow::*;
