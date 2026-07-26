/**
 * web/lib/demoArc.ts — server-only signing client for the RUN DEMO button.
 *
 * Deliberately does NOT import sdk/src/client.ts or sdk/src/instructions/*:
 * client.ts imports `Wallet` from @anchor-lang/core, whose ESM build assigns
 * it via a runtime `exports.Wallet = require(...)` inside an `if
 * (!isBrowser)` check rather than a real ESM export — Turbopack's static
 * analysis rejects that as "export doesn't exist" when bundling this for a
 * Next.js route (confirmed empirically: `next build` fails on exactly this
 * import the moment anything reaches sdk/src/client.ts). tsx-run scripts
 * never hit this because Node's own CJS/ESM interop tolerates it; Next's
 * bundler doesn't. Same class of problem web/lib/autark.ts already
 * documents solving for browser code — this is the server-side twin: reuse
 * the safe pieces (sdk/src/pdas.ts, sdk/src/types.ts — no Wallet import in
 * either) and reimplement the handful of instruction calls directly against
 * program.methods, mirroring sdk/src/instructions/{job,dispute}.ts exactly.
 *
 * This module signs real devnet transactions — it must never be imported by
 * client ("use client") code or bundled into the browser.
 */

import { BN, Program, AnchorProvider } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "../../target/idl/autark.json";
import type { Autark } from "../../target/types/autark";
import {
  agentPda,
  jobOfferPda,
  challengePda,
  mintWhitelistPda,
  slashingPoolPda,
  stakeVault,
  escrowVault,
  challengeVault,
  poolVault,
} from "../../sdk/src/pdas";

const accs = (obj: Record<string, unknown>) => obj as any;

function keypairWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if ("partialSign" in tx) tx.partialSign(kp);
      else tx.sign([kp]);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      for (const tx of txs) {
        if ("partialSign" in tx) tx.partialSign(kp);
        else tx.sign([kp]);
      }
      return txs;
    },
  };
}

export function signingProgram(kp: Keypair, rpcUrl: string): Program<Autark> {
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, keypairWallet(kp), { commitment: "confirmed" });
  return new Program<Autark>(idl as unknown as Autark, provider);
}

// ── Instruction calls — account shapes ported 1:1 from sdk/src/instructions ──

export async function proposeJob(
  program: Program<Autark>,
  consumer: Keypair,
  opts: {
    jobId: number[];
    provider: PublicKey;
    amountUsdc: number;
    acceptanceDeadline: number;
    deliveryDeadline: number;
    challengeWindowSeconds: number;
    defenseWindowSeconds: number;
    mint: PublicKey;
  }
): Promise<string> {
  const job = jobOfferPda(consumer.publicKey, Uint8Array.from(opts.jobId));
  const consumerAta = getAssociatedTokenAddressSync(opts.mint, consumer.publicKey, false);
  return program.methods
    .proposeJob(
      opts.jobId,
      opts.provider,
      new BN(Math.round(opts.amountUsdc * 1_000_000)),
      new BN(opts.acceptanceDeadline),
      new BN(opts.deliveryDeadline),
      opts.challengeWindowSeconds,
      opts.defenseWindowSeconds
    )
    .accounts(
      accs({
        jobOffer: job,
        mintWhitelist: mintWhitelistPda(),
        mint: opts.mint,
        escrowVault: escrowVault(job, opts.mint),
        consumerTokenAccount: consumerAta,
        consumer: consumer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    )
    .rpc();
}

export async function acceptJob(
  program: Program<Autark>,
  provider: Keypair,
  opts: { consumer: PublicKey; jobId: number[] }
): Promise<string> {
  const job = jobOfferPda(opts.consumer, Uint8Array.from(opts.jobId));
  return program.methods
    .acceptJob(opts.jobId)
    .accounts(accs({ jobOffer: job, agent: agentPda(provider.publicKey), provider: provider.publicKey }))
    .rpc();
}

export async function releaseEscrow(
  program: Program<Autark>,
  provider: Keypair,
  opts: { consumer: PublicKey; jobId: number[] }
): Promise<string> {
  const job = jobOfferPda(opts.consumer, Uint8Array.from(opts.jobId));
  return program.methods
    .releaseEscrow(opts.jobId)
    .accounts(accs({ jobOffer: job, provider: provider.publicKey }))
    .rpc();
}

export async function challengeSettlement(
  program: Program<Autark>,
  consumer: Keypair,
  opts: { jobId: number[]; mint: PublicKey }
): Promise<string> {
  const job = jobOfferPda(consumer.publicKey, Uint8Array.from(opts.jobId));
  const challenge = challengePda(job);
  const consumerAta = getAssociatedTokenAddressSync(opts.mint, consumer.publicKey, false);
  return program.methods
    .challengeSettlement(opts.jobId)
    .accounts(
      accs({
        jobOffer: job,
        challenge,
        stakeVault: challengeVault(challenge, opts.mint),
        consumerTokenAccount: consumerAta,
        mint: opts.mint,
        consumer: consumer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    )
    .rpc();
}

export async function resolveChallenge(
  program: Program<Autark>,
  cranker: Keypair,
  opts: { consumer: PublicKey; jobId: number[]; provider: PublicKey; challenger: PublicKey; mint: PublicKey }
): Promise<string> {
  const job = jobOfferPda(opts.consumer, Uint8Array.from(opts.jobId));
  const challenge = challengePda(job);
  const pool = slashingPoolPda();
  const providerAgent = agentPda(opts.provider);
  return program.methods
    .resolveChallenge(opts.jobId)
    .accounts(
      accs({
        jobOffer: job,
        challenge,
        challenger: opts.challenger,
        escrowVault: escrowVault(job, opts.mint),
        challengeStakeVault: challengeVault(challenge, opts.mint),
        slashingPool: pool,
        slashingPoolVault: poolVault(pool, opts.mint),
        providerAgent,
        providerStakeVault: stakeVault(providerAgent, opts.mint),
        consumerAgent: null,
        consumerTokenAccount: getAssociatedTokenAddressSync(opts.mint, opts.consumer, false),
        providerTokenAccount: getAssociatedTokenAddressSync(opts.mint, opts.provider, false),
        mint: opts.mint,
        cranker: cranker.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
    )
    .rpc();
}
