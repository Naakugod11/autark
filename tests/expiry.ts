// Tier 2.5 expiry/rejection tests run against solana-bankrun, same pattern as
// dispute.ts: short deadlines are warped past instantly via
// `ProgramTestContext.setClock()` instead of real waits.
import * as crypto from "crypto";
import { BN, Program } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Clock, ProgramTestContext, startAnchor } from "solana-bankrun";
import { Autark } from "../target/types/autark";

const PROGRAM_ID = new PublicKey(
  "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy"
);

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function mintWhitelistPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("mint_whitelist")], PROGRAM_ID)[0];
}

function slashingPoolPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("slashing_pool")], PROGRAM_ID)[0];
}

function agentPda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

function jobOfferPda(consumer: PublicKey, jobId: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), consumer.toBuffer(), Buffer.from(jobId)],
    PROGRAM_ID
  )[0];
}

function randomJobId(): number[] {
  return Array.from(crypto.randomBytes(32));
}

// ─── bankrun plumbing (same approach as dispute.ts) ─────────────────────────

function dummyProvider(payer: Keypair) {
  return {
    connection: new Connection("http://127.0.0.1:1", "confirmed"),
    publicKey: payer.publicKey,
  } as any;
}

async function send(
  context: ProgramTestContext,
  ixs: TransactionInstruction[],
  feePayer: Keypair,
  extraSigners: Keypair[] = []
): Promise<void> {
  const [blockhash] = await context.banksClient.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(...ixs);
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer.publicKey;
  tx.sign(feePayer, ...extraSigners);
  await context.banksClient.processTransaction(tx);
}

async function sendExpectFail(
  context: ProgramTestContext,
  ixs: TransactionInstruction[],
  feePayer: Keypair,
  extraSigners: Keypair[] = []
): Promise<string> {
  const [blockhash] = await context.banksClient.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(...ixs);
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer.publicKey;
  tx.sign(feePayer, ...extraSigners);
  const result = await context.banksClient.tryProcessTransaction(tx);
  expect(result.result, "expected transaction to fail but it succeeded").to.not.be.null;
  const logs = result.meta?.logMessages.join("\n") ?? "";
  return `${result.result}\n${logs}`;
}

function fundWallet(context: ProgramTestContext, pubkey: PublicKey) {
  context.setAccount(pubkey, {
    lamports: 10 * 1_000_000_000,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
  });
}

async function createMintBankrun(
  context: ProgramTestContext,
  payer: Keypair,
  decimals: number
): Promise<PublicKey> {
  const mint = Keypair.generate();
  const rent = await context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(MINT_SIZE)));
  await send(
    context,
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(mint.publicKey, decimals, payer.publicKey, null),
    ],
    payer,
    [mint]
  );
  return mint.publicKey;
}

async function createAtaAndMint(
  context: ProgramTestContext,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount: number
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  await send(
    context,
    [
      createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint),
      createMintToInstruction(mint, ata, payer.publicKey, amount),
    ],
    payer
  );
  return ata;
}

async function getTokenBalance(context: ProgramTestContext, address: PublicKey): Promise<bigint> {
  const info = await context.banksClient.getAccount(address);
  if (!info) throw new Error(`token account not found: ${address.toBase58()}`);
  const acc = unpackAccount(address, { ...info, data: Buffer.from(info.data) } as any);
  return acc.amount;
}

async function fetchAccount<T>(
  context: ProgramTestContext,
  program: Program<Autark>,
  name: string,
  address: PublicKey
): Promise<T> {
  const info = await context.banksClient.getAccount(address);
  if (!info) throw new Error(`account not found (${name}): ${address.toBase58()}`);
  return program.coder.accounts.decode<T>(name, Buffer.from(info.data));
}

async function warpSeconds(context: ProgramTestContext, seconds: number) {
  const clock = await context.banksClient.getClock();
  context.setClock(
    new Clock(
      clock.slot,
      clock.epochStartTimestamp,
      clock.epoch,
      clock.leaderScheduleEpoch,
      clock.unixTimestamp + BigInt(seconds)
    )
  );
}

async function sendCapturingEvents(
  context: ProgramTestContext,
  program: Program<Autark>,
  ix: TransactionInstruction,
  feePayer: Keypair,
  extraSigners: Keypair[] = []
): Promise<{ name: string; data: any }[]> {
  const [blockhash] = await context.banksClient.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer.publicKey;
  tx.sign(feePayer, ...extraSigners);
  const meta = await context.banksClient.processTransaction(tx);
  return meta.logMessages
    .filter((l) => l.startsWith("Program data: "))
    .map((l) => program.coder.events.decode(l.slice("Program data: ".length)))
    .filter((e): e is { name: string; data: any } => e !== null);
}

function findEvent(events: { name: string; data: any }[], name: string) {
  const found = events.find((e) => e.name === name);
  expect(found, `expected ${name} event`).to.not.be.undefined;
  return found!.data;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("autark expiry: reject_job + cancel_expired_job", () => {
  let context: ProgramTestContext;
  let program: Program<Autark>;
  let deployer: Keypair;
  let mint: PublicKey;
  let provider: Keypair;
  let providerTokenAccount: PublicKey;

  const STAKE = 50_000_000; // 50 USDC

  beforeEach(async () => {
    context = await startAnchor(".", [], []);
    deployer = context.payer;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const idl = require("../target/idl/autark.json");
    program = new Program<Autark>(idl, dummyProvider(deployer));

    mint = await createMintBankrun(context, deployer, 6);

    await send(
      context,
      [
        await program.methods
          .initMintWhitelist()
          .accounts({
            mintWhitelist: mintWhitelistPda(),
            authority: deployer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ],
      deployer
    );
    await send(
      context,
      [
        await program.methods
          .addWhitelistedMint(mint)
          .accounts({
            mintWhitelist: mintWhitelistPda(),
            authority: deployer.publicKey,
          })
          .instruction(),
      ],
      deployer
    );
    const slashingVault = getAssociatedTokenAddressSync(mint, slashingPoolPda(), true);
    await send(
      context,
      [
        await program.methods
          .initSlashingPool()
          .accounts({
            mintWhitelist: mintWhitelistPda(),
            slashingPool: slashingPoolPda(),
            mint,
            vault: slashingVault,
            authority: deployer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ],
      deployer
    );

    provider = Keypair.generate();
    fundWallet(context, provider.publicKey);
    providerTokenAccount = await createAtaAndMint(
      context,
      deployer,
      mint,
      provider.publicKey,
      1_000_000_000
    );
    const stakeVault = getAssociatedTokenAddressSync(mint, agentPda(provider.publicKey), true);
    await send(
      context,
      [
        await program.methods
          .registerAgent(["wallet-analysis"], "https://provider.example.com", new BN(STAKE))
          .accounts({
            agent: agentPda(provider.publicKey),
            mintWhitelist: mintWhitelistPda(),
            mint,
            stakeVault,
            ownerTokenAccount: providerTokenAccount,
            owner: provider.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ],
      provider
    );
  });

  async function proposeJob(
    amount: number,
    acceptanceOffset: number,
    deliveryOffset: number
  ): Promise<{
    consumer: Keypair;
    consumerTokenAccount: PublicKey;
    jobId: number[];
    jobOffer: PublicKey;
    escrowVault: PublicKey;
  }> {
    const consumer = Keypair.generate();
    fundWallet(context, consumer.publicKey);
    const consumerTokenAccount = await createAtaAndMint(
      context,
      deployer,
      mint,
      consumer.publicKey,
      1_000_000_000
    );

    const jobId = randomJobId();
    const now = Math.floor(Date.now() / 1000);
    const jobOffer = jobOfferPda(consumer.publicKey, jobId);
    const escrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    await send(
      context,
      [
        await program.methods
          .proposeJob(
            jobId,
            provider.publicKey,
            new BN(amount),
            new BN(now + acceptanceOffset),
            new BN(now + deliveryOffset),
            0,
            0
          )
          .accounts({
            jobOffer,
            mintWhitelist: mintWhitelistPda(),
            mint,
            escrowVault,
            consumerTokenAccount,
            consumer: consumer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ],
      consumer
    );

    return { consumer, consumerTokenAccount, jobId, jobOffer, escrowVault };
  }

  async function acceptJob(jobOffer: PublicKey, jobId: number[]) {
    await send(
      context,
      [
        await program.methods
          .acceptJob(jobId)
          .accounts({
            jobOffer,
            agent: agentPda(provider.publicKey),
            provider: provider.publicKey,
          })
          .instruction(),
      ],
      provider
    );
  }

  function cancelExpiredJobIx(jobOffer: PublicKey, jobId: number[], escrowVault: PublicKey, consumerTokenAccount: PublicKey) {
    const slashingVault = getAssociatedTokenAddressSync(mint, slashingPoolPda(), true);
    const providerStakeVault = getAssociatedTokenAddressSync(mint, agentPda(provider.publicKey), true);
    return program.methods
      .cancelExpiredJob(jobId)
      .accounts({
        jobOffer,
        escrowVault,
        consumerTokenAccount,
        providerAgent: agentPda(provider.publicKey),
        providerStakeVault,
        slashingPool: slashingPoolPda(),
        slashingPoolVault: slashingVault,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  it("REJECT: propose -> reject_job — full refund, no slash", async () => {
    const amount = 5_000_000;
    const { consumer, consumerTokenAccount, jobId, jobOffer, escrowVault } = await proposeJob(
      amount,
      3600,
      7200
    );

    const consumerBalanceBefore = await getTokenBalance(context, consumerTokenAccount);
    const poolBefore = await fetchAccount<any>(context, program, "slashingPool", slashingPoolPda());

    const ix = await program.methods
      .rejectJob(jobId)
      .accounts({
        jobOffer,
        escrowVault,
        consumerTokenAccount,
        mint,
        provider: provider.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const events = await sendCapturingEvents(context, program, ix, provider);
    const rejected = findEvent(events, "jobRejected");
    expect(rejected.refunded.toNumber()).to.equal(amount);

    const consumerBalanceAfter = await getTokenBalance(context, consumerTokenAccount);
    expect(Number(consumerBalanceAfter - consumerBalanceBefore)).to.equal(amount);

    const jobOfferAccount = await fetchAccount<any>(context, program, "jobOffer", jobOffer);
    expect(jobOfferAccount.status).to.deep.equal({ rejected: {} });

    const agent = await fetchAccount<any>(context, program, "agent", agentPda(provider.publicKey));
    expect(agent.stakeAmount.toNumber()).to.equal(STAKE);

    const poolAfter = await fetchAccount<any>(context, program, "slashingPool", slashingPoolPda());
    expect(poolAfter.totalSlashed.toNumber()).to.equal(poolBefore.totalSlashed.toNumber());
  });

  it("EXPIRED: provider ghosts acceptance -> 5% of total stake slashed", async () => {
    const amount = 5_000_000;
    const { consumerTokenAccount, jobId, jobOffer, escrowVault } = await proposeJob(amount, 5, 7200);

    const consumerBalanceBefore = await getTokenBalance(context, consumerTokenAccount);

    await warpSeconds(context, 10);

    const ix = await cancelExpiredJobIx(jobOffer, jobId, escrowVault, consumerTokenAccount);
    const events = await sendCapturingEvents(context, program, ix, deployer);
    const expired = findEvent(events, "jobExpired");
    expect(expired.refunded.toNumber()).to.equal(amount);

    const consumerBalanceAfter = await getTokenBalance(context, consumerTokenAccount);
    expect(Number(consumerBalanceAfter - consumerBalanceBefore)).to.equal(amount);

    const jobOfferAccount = await fetchAccount<any>(context, program, "jobOffer", jobOffer);
    expect(jobOfferAccount.status).to.deep.equal({ expired: {} });

    const agent = await fetchAccount<any>(context, program, "agent", agentPda(provider.publicKey));
    const expectedSlash = Math.floor((500 * STAKE) / 10_000); // SLASH_PCT_PROPOSED_EXPIRED = 500 bps
    expect(agent.stakeAmount.toNumber()).to.equal(STAKE - expectedSlash);
    expect(agent.scoreFailed.toNumber()).to.equal(1);
    expect(agent.slashEvents).to.equal(0); // Expired does NOT bump slash_events
    expect(expired.slashed.toNumber()).to.equal(expectedSlash);
    expect(expired.scoreFailed.toNumber()).to.equal(agent.scoreFailed.toNumber());

    const pool = await fetchAccount<any>(context, program, "slashingPool", slashingPoolPda());
    expect(pool.totalSlashed.toNumber()).to.equal(expectedSlash);
  });

  it("ABANDONED: provider ghosts delivery -> 30% of earmark slashed", async () => {
    const amount = 5_000_000;
    const { consumerTokenAccount, jobId, jobOffer, escrowVault } = await proposeJob(amount, 5, 10);
    await acceptJob(jobOffer, jobId);

    const consumerBalanceBefore = await getTokenBalance(context, consumerTokenAccount);

    await warpSeconds(context, 20);

    const ix = await cancelExpiredJobIx(jobOffer, jobId, escrowVault, consumerTokenAccount);
    const events = await sendCapturingEvents(context, program, ix, deployer);
    const abandoned = findEvent(events, "jobAbandoned");
    expect(abandoned.refunded.toNumber()).to.equal(amount);

    const consumerBalanceAfter = await getTokenBalance(context, consumerTokenAccount);
    expect(Number(consumerBalanceAfter - consumerBalanceBefore)).to.equal(amount);

    const jobOfferAccount = await fetchAccount<any>(context, program, "jobOffer", jobOffer);
    expect(jobOfferAccount.status).to.deep.equal({ abandoned: {} });

    const agent = await fetchAccount<any>(context, program, "agent", agentPda(provider.publicKey));
    // earmark = min(stake_amount, amount) = amount (amount < STAKE here)
    const expectedSlash = Math.floor((3000 * amount) / 10_000); // SLASH_PCT_ABANDONED = 3000 bps
    expect(agent.stakeAmount.toNumber()).to.equal(STAKE - expectedSlash);
    expect(agent.openJobs).to.equal(0);
    expect(agent.scoreFailed.toNumber()).to.equal(1);
    expect(agent.slashEvents).to.equal(1);
    expect(agent.lastSlashSlot.toNumber()).to.be.greaterThan(0);

    expect(abandoned.slashed.toNumber()).to.equal(expectedSlash);
    expect(abandoned.scoreFailed.toNumber()).to.equal(agent.scoreFailed.toNumber());
    expect(abandoned.slashEvents).to.equal(agent.slashEvents);

    const pool = await fetchAccount<any>(context, program, "slashingPool", slashingPoolPda());
    expect(pool.totalSlashed.toNumber()).to.equal(expectedSlash);
  });

  it("NEGATIVE: cancel_expired_job on Proposed before acceptance_deadline fails", async () => {
    const { consumerTokenAccount, jobId, jobOffer, escrowVault } = await proposeJob(
      1_000_000,
      3600,
      7200
    );
    const ix = await cancelExpiredJobIx(jobOffer, jobId, escrowVault, consumerTokenAccount);
    const err = await sendExpectFail(context, [ix], deployer);
    expect(err).to.match(/AcceptanceWindowNotExpired/);
  });

  it("NEGATIVE: cancel_expired_job on Accepted before delivery_deadline fails", async () => {
    const { consumerTokenAccount, jobId, jobOffer, escrowVault } = await proposeJob(
      1_000_000,
      3600,
      7200
    );
    await acceptJob(jobOffer, jobId);
    const ix = await cancelExpiredJobIx(jobOffer, jobId, escrowVault, consumerTokenAccount);
    const err = await sendExpectFail(context, [ix], deployer);
    expect(err).to.match(/DeliveryWindowNotExpired/);
  });

  it("NEGATIVE: reject_job by non-provider fails", async () => {
    const { jobId, jobOffer, escrowVault, consumerTokenAccount } = await proposeJob(
      1_000_000,
      3600,
      7200
    );
    const impostor = Keypair.generate();
    fundWallet(context, impostor.publicKey);

    const ix = await program.methods
      .rejectJob(jobId)
      .accounts({
        jobOffer,
        escrowVault,
        consumerTokenAccount,
        mint,
        provider: impostor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const err = await sendExpectFail(context, [ix], impostor);
    expect(err).to.match(/NotProvider|ConstraintHasOne/);
  });

  it("NEGATIVE: cancel_expired_job on a terminal (Rejected) job fails", async () => {
    const { jobId, jobOffer, escrowVault, consumerTokenAccount } = await proposeJob(
      1_000_000,
      3600,
      7200
    );
    await send(
      context,
      [
        await program.methods
          .rejectJob(jobId)
          .accounts({
            jobOffer,
            escrowVault,
            consumerTokenAccount,
            mint,
            provider: provider.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ],
      provider
    );

    const ix = await cancelExpiredJobIx(jobOffer, jobId, escrowVault, consumerTokenAccount);
    const err = await sendExpectFail(context, [ix], deployer);
    expect(err).to.match(/InvalidStatus/);
  });
});
