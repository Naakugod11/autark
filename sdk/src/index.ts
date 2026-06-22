import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey(
  "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy"
);
const USDC_FACTOR = 1_000_000; // 6 decimals — 1 USDC = 1_000_000 micro-USDC

// ─── IDL loading ─────────────────────────────────────────────────────────────
// __dirname here is sdk/src/ at runtime (tsx) or sdk/dist/ after tsc.
// Both resolve ../../target/idl/agent_bazaar.json to the repo root correctly.
const idl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../target/idl/agent_bazaar.json"),
    "utf-8"
  )
);

// Bring in generated TypeScript types for full type safety.
type AgentBazaarProgram = import("../../target/types/agent_bazaar").AgentBazaar;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
}

// Build a writable program instance (signer pays fees).
function makeProgram(signer: Keypair) {
  const conn = new Connection(getRpcUrl(), "confirmed");
  const wallet = new Wallet(signer);
  const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
  const program = new Program<AgentBazaarProgram>(idl, provider);
  return { program, conn };
}

// Build a read-only program instance (no real signer needed).
function readProgram() {
  const dummy = Keypair.generate();
  const conn = new Connection(getRpcUrl(), "confirmed");
  const wallet = new Wallet(dummy);
  const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
  const program = new Program<AgentBazaarProgram>(idl, provider);
  return { program, conn };
}

// Anchor 1.0 TypeScript workaround: .accounts() uses a strict union type that
// rejects multi-key object literals. Cast through any — runtime is correct.
const accs = (obj: Record<string, unknown>) => obj as any;

// ─── PDA derivation (also exported for frontend use) ─────────────────────────

export function agentPda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function jobOfferPda(consumer: PublicKey, jobId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), consumer.toBuffer(), Buffer.from(jobId)],
    PROGRAM_ID
  )[0];
}

// The escrow is the ATA owned by the job offer PDA.
// allowOwnerOffCurve=true because the authority is a PDA (not a normal wallet).
export function escrowAta(jobOffer: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, jobOffer, true);
}

// ─── Status parsing ───────────────────────────────────────────────────────────
// Anchor 1.0 deserialises enum variants as { proposed: {} }, NOT the string "Proposed".

type JobStatus = "proposed" | "accepted" | "settled" | "rejected" | "expired";

function parseStatus(raw: unknown): JobStatus {
  const r = raw as Record<string, unknown>;
  if (r.proposed !== undefined) return "proposed";
  if (r.accepted !== undefined) return "accepted";
  if (r.settled !== undefined) return "settled";
  if (r.rejected !== undefined) return "rejected";
  return "expired";
}

// ─── Exported types ───────────────────────────────────────────────────────────

export type AgentAccount = {
  pubkey: PublicKey;
  owner: PublicKey;
  name: string;
  capability: string;
  endpoint: string;
  priceHint: number; // micro-USDC (6 decimals)
  bump: number;
};

export type JobAccount = {
  pubkey: PublicKey;
  consumer: PublicKey;
  provider: PublicKey;
  jobId: number[];
  offerAmount: number; // micro-USDC
  acceptanceDeadline: number; // unix seconds
  deliveryDeadline: number; // unix seconds
  status: JobStatus;
  resultHash: number[] | null;
  bump: number;
};

// ─── Write methods ────────────────────────────────────────────────────────────

export async function registerAgent(params: {
  signer: Keypair;
  name: string;
  capability: string;
  endpoint: string;
  pricePerCall: number; // in USDC (e.g. 0.01 = 10_000 micro-USDC)
}): Promise<{ agentPda: PublicKey; signature: string }> {
  const { program } = makeProgram(params.signer);
  const addr = agentPda(params.signer.publicKey);
  const priceHint = new BN(Math.round(params.pricePerCall * USDC_FACTOR));

  const signature = await program.methods
    .registerAgent(params.name, params.capability, params.endpoint, priceHint)
    .accounts(
      accs({
        agent: addr,
        owner: params.signer.publicKey,
        systemProgram: SystemProgram.programId,
      })
    )
    .signers([params.signer])
    .rpc();

  return { agentPda: addr, signature };
}

export async function proposeJob(params: {
  signer: Keypair; // consumer — this wallet's USDC goes into escrow
  providerWallet: PublicKey; // provider's wallet pubkey (NOT the agent PDA)
  jobId: Uint8Array; // 32 random bytes you generate
  amount: number; // in USDC (e.g. 0.01)
  acceptanceDeadline: number; // unix seconds
  deliveryDeadline: number; // unix seconds
  usdcMint: PublicKey;
}): Promise<{ jobPda: PublicKey; signature: string }> {
  const { program } = makeProgram(params.signer);
  const job = jobOfferPda(params.signer.publicKey, params.jobId);
  const escrow = escrowAta(job, params.usdcMint);
  const provAgent = agentPda(params.providerWallet);
  const consumerAta = getAssociatedTokenAddressSync(
    params.usdcMint,
    params.signer.publicKey
  );
  const offerAmount = new BN(Math.round(params.amount * USDC_FACTOR));

  const signature = await program.methods
    .proposeJob(
      Array.from(params.jobId),
      offerAmount,
      new BN(params.acceptanceDeadline),
      new BN(params.deliveryDeadline)
    )
    .accounts(
      accs({
        jobOffer: job,
        escrowTokenAccount: escrow,
        providerAgent: provAgent,
        consumerTokenAccount: consumerAta,
        consumer: params.signer.publicKey,
        usdcMint: params.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    )
    .signers([params.signer])
    .rpc();

  return { jobPda: job, signature };
}

export async function acceptJob(params: {
  signer: Keypair; // provider
  consumer: PublicKey;
  jobId: Uint8Array;
}): Promise<{ signature: string }> {
  const { program } = makeProgram(params.signer);
  const job = jobOfferPda(params.consumer, params.jobId);

  const signature = await program.methods
    .acceptJob(Array.from(params.jobId))
    .accounts(
      accs({
        jobOffer: job,
        provider: params.signer.publicKey,
      })
    )
    .signers([params.signer])
    .rpc();

  return { signature };
}

export async function releaseEscrow(params: {
  signer: Keypair; // provider
  consumer: PublicKey;
  jobId: Uint8Array;
  resultHash: Uint8Array; // 32 bytes — SHA-256 of the delivered work
  usdcMint: PublicKey;
}): Promise<{ signature: string }> {
  const { program, conn } = makeProgram(params.signer);
  const job = jobOfferPda(params.consumer, params.jobId);
  const escrow = escrowAta(job, params.usdcMint);

  // Create provider ATA if it doesn't exist yet (first-time payment receiver).
  const providerAtaInfo = await getOrCreateAssociatedTokenAccount(
    conn,
    params.signer,
    params.usdcMint,
    params.signer.publicKey
  );

  const signature = await program.methods
    .releaseEscrow(Array.from(params.jobId), Array.from(params.resultHash))
    .accounts(
      accs({
        jobOffer: job,
        escrowTokenAccount: escrow,
        providerTokenAccount: providerAtaInfo.address,
        provider: params.signer.publicKey,
        usdcMint: params.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    )
    .signers([params.signer])
    .rpc();

  return { signature };
}

export async function rejectJob(params: {
  signer: Keypair; // provider
  consumer: PublicKey;
  jobId: Uint8Array;
  usdcMint: PublicKey;
}): Promise<{ signature: string }> {
  const { program } = makeProgram(params.signer);
  const job = jobOfferPda(params.consumer, params.jobId);
  const escrow = escrowAta(job, params.usdcMint);
  const consumerAta = getAssociatedTokenAddressSync(
    params.usdcMint,
    params.consumer
  );

  const signature = await program.methods
    .rejectJob(Array.from(params.jobId))
    .accounts(
      accs({
        jobOffer: job,
        escrowTokenAccount: escrow,
        consumerTokenAccount: consumerAta,
        consumer: params.consumer,
        provider: params.signer.publicKey,
        usdcMint: params.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    )
    .signers([params.signer])
    .rpc();

  return { signature };
}

export async function cancelExpiredJob(params: {
  signer: Keypair; // consumer
  jobId: Uint8Array;
  usdcMint: PublicKey;
}): Promise<{ signature: string }> {
  const { program } = makeProgram(params.signer);
  const job = jobOfferPda(params.signer.publicKey, params.jobId);
  const escrow = escrowAta(job, params.usdcMint);
  const consumerAta = getAssociatedTokenAddressSync(
    params.usdcMint,
    params.signer.publicKey
  );

  const signature = await program.methods
    .cancelExpiredJob(Array.from(params.jobId))
    .accounts(
      accs({
        jobOffer: job,
        escrowTokenAccount: escrow,
        consumerTokenAccount: consumerAta,
        consumer: params.signer.publicKey,
        usdcMint: params.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
    )
    .signers([params.signer])
    .rpc();

  return { signature };
}

// ─── Read methods ─────────────────────────────────────────────────────────────

export async function listAgents(): Promise<AgentAccount[]> {
  const { program } = readProgram();
  const accounts = await program.account.agentAccount.all();
  return accounts.map((a) => ({
    pubkey: a.publicKey,
    owner: a.account.owner,
    name: a.account.name,
    capability: a.account.capability,
    endpoint: a.account.endpoint,
    priceHint: (a.account.priceHint as BN).toNumber(),
    bump: a.account.bump,
  }));
}

export async function getJob(
  consumer: PublicKey,
  jobId: Uint8Array
): Promise<JobAccount> {
  const { program } = readProgram();
  const job = jobOfferPda(consumer, jobId);
  const a = await program.account.jobOffer.fetch(job);
  return {
    pubkey: job,
    consumer: a.consumer,
    provider: a.provider,
    jobId: a.jobId as number[],
    offerAmount: (a.offerAmount as BN).toNumber(),
    acceptanceDeadline: (a.acceptanceDeadline as BN).toNumber(),
    deliveryDeadline: (a.deliveryDeadline as BN).toNumber(),
    status: parseStatus(a.status),
    resultHash: (a.resultHash as number[] | null) ?? null,
    bump: a.bump,
  };
}

export async function listJobs(): Promise<JobAccount[]> {
  const { program } = readProgram();
  const accounts = await program.account.jobOffer.all();
  return accounts.map((a) => ({
    pubkey: a.publicKey,
    consumer: a.account.consumer,
    provider: a.account.provider,
    jobId: a.account.jobId as number[],
    offerAmount: (a.account.offerAmount as BN).toNumber(),
    acceptanceDeadline: (a.account.acceptanceDeadline as BN).toNumber(),
    deliveryDeadline: (a.account.deliveryDeadline as BN).toNumber(),
    status: parseStatus(a.account.status),
    resultHash: (a.account.resultHash as number[] | null) ?? null,
    bump: a.account.bump,
  }));
}
