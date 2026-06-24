import { BN, Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { Autark } from "../../../target/types/autark";
import { accs } from "../client";
import { agentPda, mintWhitelistPda, stakeVault } from "../pdas";
import { IxBuilder, makeIx, toUSDC } from "./utils";

// ── registerAgent ─────────────────────────────────────────────────────────────
// Signer = owner.  Creates agent PDA + stake vault ATA, transfers initial_stake
// from owner's token account.

export type RegisterAgentParams = {
  capabilities: string[];
  endpointUrl: string;
  initialStake: number; // USDC float, e.g. 5.0 → 5_000_000
  mint: PublicKey;
};

export function buildRegisterAgent(
  program: Program<Autark>,
  params: RegisterAgentParams
): IxBuilder {
  const owner = program.provider.publicKey!;
  const agent = agentPda(owner);
  const wl = mintWhitelistPda();
  const sv = stakeVault(agent, params.mint);
  const ownerAta = getAssociatedTokenAddressSync(params.mint, owner, false);
  const mk = () =>
    program.methods
      .registerAgent(
        params.capabilities,
        params.endpointUrl,
        toUSDC(params.initialStake)
      )
      .accounts(
        accs({
          agent,
          mintWhitelist: wl,
          mint: params.mint,
          stakeVault: sv,
          ownerTokenAccount: ownerAta,
          owner,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
      );
  return makeIx(mk);
}

// ── updateAgentCapabilities ───────────────────────────────────────────────────
// Signer = owner (relation enforced on-chain).

export type UpdateAgentCapabilitiesParams = {
  newCapabilities: string[];
  newEndpointUrl: string;
};

export function buildUpdateAgentCapabilities(
  program: Program<Autark>,
  params: UpdateAgentCapabilitiesParams
): IxBuilder {
  const owner = program.provider.publicKey!;
  const agent = agentPda(owner);
  const mk = () =>
    program.methods
      .updateAgentCapabilities(params.newCapabilities, params.newEndpointUrl)
      .accounts(
        accs({
          agent,
          owner,
        })
      );
  return makeIx(mk);
}

// ── stakeDeposit ──────────────────────────────────────────────────────────────
// Signer = owner. stakeVault and ownerTokenAccount are derived; pass
// ownerTokenAccount override when owner uses a non-standard ATA.

export type StakeDepositParams = {
  amount: number; // USDC float
  mint: PublicKey;
  ownerTokenAccount?: PublicKey;
};

export function buildStakeDeposit(
  program: Program<Autark>,
  params: StakeDepositParams
): IxBuilder {
  const owner = program.provider.publicKey!;
  const agent = agentPda(owner);
  const sv = stakeVault(agent, params.mint);
  const ownerAta =
    params.ownerTokenAccount ??
    getAssociatedTokenAddressSync(params.mint, owner, false);
  const mk = () =>
    program.methods.stakeDeposit(toUSDC(params.amount)).accounts(
      accs({
        agent,
        stakeVault: sv,
        ownerTokenAccount: ownerAta,
        owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    );
  return makeIx(mk);
}

// ── stakeWithdraw ─────────────────────────────────────────────────────────────
// Signer = owner.  Program enforces open_jobs == 0 guard.

export type StakeWithdrawParams = {
  amount: number; // USDC float
  mint: PublicKey;
  ownerTokenAccount?: PublicKey;
};

export function buildStakeWithdraw(
  program: Program<Autark>,
  params: StakeWithdrawParams
): IxBuilder {
  const owner = program.provider.publicKey!;
  const agent = agentPda(owner);
  const sv = stakeVault(agent, params.mint);
  const ownerAta =
    params.ownerTokenAccount ??
    getAssociatedTokenAddressSync(params.mint, owner, false);
  const mk = () =>
    program.methods.stakeWithdraw(toUSDC(params.amount)).accounts(
      accs({
        agent,
        stakeVault: sv,
        ownerTokenAccount: ownerAta,
        owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    );
  return makeIx(mk);
}
