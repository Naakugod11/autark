import { Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { Autark } from "../../../target/types/autark";
import { accs } from "../client";
import { mintWhitelistPda, slashingPoolPda, poolVault } from "../pdas";
import { IxBuilder, makeIx } from "./utils";

// ── initMintWhitelist ─────────────────────────────────────────────────────────
// Signer becomes the MintWhitelist authority. One-time singleton init.

export function buildInitMintWhitelist(program: Program<Autark>): IxBuilder {
  const wl = mintWhitelistPda();
  const mk = () =>
    program.methods.initMintWhitelist().accounts(
      accs({
        mintWhitelist: wl,
        authority: program.provider.publicKey,
        systemProgram: SystemProgram.programId,
      })
    );
  return makeIx(mk);
}

// ── addWhitelistedMint ────────────────────────────────────────────────────────
// Signer must be MintWhitelist.authority.

export type AddWhitelistedMintParams = {
  mint: PublicKey;
};

export function buildAddWhitelistedMint(
  program: Program<Autark>,
  params: AddWhitelistedMintParams
): IxBuilder {
  const wl = mintWhitelistPda();
  const mk = () =>
    program.methods.addWhitelistedMint(params.mint).accounts(
      accs({
        mintWhitelist: wl,
        authority: program.provider.publicKey,
      })
    );
  return makeIx(mk);
}

// ── initSlashingPool ──────────────────────────────────────────────────────────
// Signer must be MintWhitelist.authority.  Vault is the ATA of the pool PDA.

export type InitSlashingPoolParams = {
  mint: PublicKey;
};

export function buildInitSlashingPool(
  program: Program<Autark>,
  params: InitSlashingPoolParams
): IxBuilder {
  const wl = mintWhitelistPda();
  const pool = slashingPoolPda();
  const vault = poolVault(pool, params.mint);
  const mk = () =>
    program.methods.initSlashingPool().accounts(
      accs({
        mintWhitelist: wl,
        slashingPool: pool,
        mint: params.mint,
        vault,
        authority: program.provider.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    );
  return makeIx(mk);
}
