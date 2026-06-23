// Tier 2 dispute/slash tests run against solana-bankrun (an in-process
// LiteSVM-backed validator), NOT the live solana-test-validator used by
// happy_path.ts/bounty.ts. Originally this was load-bearing because the
// defense window was a hardcoded 48h constant; as of the Tier 2.5 fix it's a
// per-job param (defense_window_seconds), so production callers pass
// whatever they like and this suite passes a short one (TEST_DEFENSE_WINDOW
// below) to keep the warp trivial. We still use bankrun's
// `ProgramTestContext.setClock()` rather than a live validator both for
// speed and to avoid relying on a real clock for sub-second-precision
// assertions.
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

// A short, per-test defense window — proves defense_deadline derives from
// this param (which varies across tests below), not from any program const.
const TEST_DEFENSE_WINDOW = 5;

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function mintWhitelistPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_whitelist")],
    PROGRAM_ID
  )[0];
}

function slashingPoolPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("slashing_pool")],
    PROGRAM_ID
  )[0];
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

function challengePda(job: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("challenge"), job.toBuffer()],
    PROGRAM_ID
  )[0];
}

function randomJobId(): number[] {
  return Array.from(crypto.randomBytes(32));
}

// ─── bankrun plumbing ────────────────────────────────────────────────────────
//
// @anchor-lang/core's Program only needs `provider.connection` to exist for
// construction; every call in this file goes through `.instruction()` (never
// `.rpc()`/`.fetch()`), so the connection is never actually dialed. All
// sending/decoding below talks to bankrun's BanksClient directly.

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
  const signers = [feePayer, ...extraSigners];
  tx.sign(...signers);
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
  const signers = [feePayer, ...extraSigners];
  tx.sign(...signers);
  const result = await context.banksClient.tryProcessTransaction(tx);
  expect(result.result, "expected transaction to fail but it succeeded").to
    .not.be.null;
  // `result.result` is just "Error processing Instruction 0: custom program
  // error: 0x...." — the readable "Error Code: XYZ" text lives in the
  // program logs instead, so combine both for matching.
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

async function getTokenBalance(
  context: ProgramTestContext,
  address: PublicKey
): Promise<bigint> {
  const info = await context.banksClient.getAccount(address);
  if (!info) throw new Error(`token account not found: ${address.toBase58()}`);
  const acc = unpackAccount(address, {
    ...info,
    data: Buffer.from(info.data),
  } as any);
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

async function accountExists(
  context: ProgramTestContext,
  address: PublicKey
): Promise<boolean> {
  const info = await context.banksClient.getAccount(address);
  return info !== null;
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

async function decodeEvents(
  context: ProgramTestContext,
  program: Program<Autark>,
  tx: Transaction
): Promise<{ name: string; data: any }[]> {
  const meta = await context.banksClient.processTransaction(tx);
  return meta.logMessages
    .filter((l) => l.startsWith("Program data: "))
    .map((l) => program.coder.events.decode(l.slice("Program data: ".length)))
    .filter((e): e is { name: string; data: any } => e !== null);
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("autark dispute: challenge + resolve (both-burn MAD)", () => {
  let context: ProgramTestContext;
  let program: Program<Autark>;
  let deployer: Keypair;
  let mint: PublicKey;

  // A fresh bankrun context per test: warpSeconds() in earlier tests would
  // otherwise leak a far-future chain clock into later tests, making
  // Date.now()-based deadlines (acceptance_deadline etc.) stale on arrival.
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
  });

  const STAKE = 50_000_000; // 50 USDC

  async function registerAgent(): Promise<{ owner: Keypair; tokenAccount: PublicKey }> {
    const owner = Keypair.generate();
    fundWallet(context, owner.publicKey);
    const tokenAccount = await createAtaAndMint(context, deployer, mint, owner.publicKey, 1_000_000_000);
    const stakeVault = getAssociatedTokenAddressSync(mint, agentPda(owner.publicKey), true);

    await send(
      context,
      [
        await program.methods
          .registerAgent(["wallet-analysis"], "https://provider.example.com", new BN(STAKE))
          .accounts({
            agent: agentPda(owner.publicKey),
            mintWhitelist: mintWhitelistPda(),
            mint,
            stakeVault,
            ownerTokenAccount: tokenAccount,
            owner: owner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ],
      owner
    );

    return { owner, tokenAccount };
  }

  async function proposeAcceptRelease(
    provider: Keypair,
    challengeWindowSeconds: number,
    defenseWindowSeconds: number
  ): Promise<{
    consumer: Keypair;
    consumerTokenAccount: PublicKey;
    jobId: number[];
    jobOffer: PublicKey;
    escrowVault: PublicKey;
    amount: number;
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
    const amount = 5_000_000; // 5 USDC
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
            new BN(now + 3600),
            new BN(now + 7200),
            challengeWindowSeconds,
            defenseWindowSeconds
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

    await send(
      context,
      [
        await program.methods
          .releaseEscrow(jobId)
          .accounts({
            jobOffer,
            provider: provider.publicKey,
          })
          .instruction(),
      ],
      provider
    );

    return { consumer, consumerTokenAccount, jobId, jobOffer, escrowVault, amount };
  }

  async function openChallenge(
    consumer: Keypair,
    consumerTokenAccount: PublicKey,
    jobId: number[],
    jobOffer: PublicKey,
    defenseWindowSeconds: number
  ): Promise<{ challenge: PublicKey; stakeVault: PublicKey }> {
    const challenge = challengePda(jobOffer);
    const stakeVault = getAssociatedTokenAddressSync(mint, challenge, true);

    const ix = await program.methods
      .challengeSettlement(jobId)
      .accounts({
        jobOffer,
        challenge,
        stakeVault,
        consumerTokenAccount,
        mint,
        consumer: consumer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const [blockhash] = await context.banksClient.getLatestBlockhash();
    const tx = new Transaction();
    tx.add(ix);
    tx.recentBlockhash = blockhash;
    tx.feePayer = consumer.publicKey;
    tx.sign(consumer);
    const events = await decodeEvents(context, program, tx);
    const opened = events.find((e) => e.name === "challengeOpened");
    expect(opened, "expected ChallengeOpened event").to.not.be.undefined;

    // Proves defense_deadline derives from the per-job param passed to
    // propose_job, not from a hardcoded program constant.
    const challengeAccount = await fetchAccount<any>(context, program, "challenge", challenge);
    expect(challengeAccount.defenseDeadline.toNumber()).to.equal(
      challengeAccount.openedAt.toNumber() + defenseWindowSeconds
    );

    return { challenge, stakeVault };
  }

  it("UNDEFENDED: provider never defends -> consumer refunded, provider slashed", async () => {
    const { owner: provider, tokenAccount: providerTokenAccount } = await registerAgent();
    const { consumer, consumerTokenAccount, jobId, jobOffer, escrowVault, amount } =
      await proposeAcceptRelease(provider, 0, TEST_DEFENSE_WINDOW);

    const { challenge, stakeVault } = await openChallenge(
      consumer,
      consumerTokenAccount,
      jobId,
      jobOffer,
      TEST_DEFENSE_WINDOW
    );

    // fast-forward past the (short, per-job) defense window — no real wait.
    await warpSeconds(context, TEST_DEFENSE_WINDOW + 10);

    const consumerBalanceBefore = await getTokenBalance(context, consumerTokenAccount);
    const poolBefore = await fetchAccount<any>(
      context,
      program,
      "slashingPool",
      slashingPoolPda()
    );

    const slashingVault = getAssociatedTokenAddressSync(mint, slashingPoolPda(), true);
    const providerStakeVault = getAssociatedTokenAddressSync(
      mint,
      agentPda(provider.publicKey),
      true
    );

    const ix = await program.methods
      .resolveChallenge(jobId)
      .accounts({
        jobOffer,
        challenge,
        challenger: consumer.publicKey,
        escrowVault,
        challengeStakeVault: stakeVault,
        slashingPool: slashingPoolPda(),
        slashingPoolVault: slashingVault,
        providerAgent: agentPda(provider.publicKey),
        providerStakeVault,
        consumerAgent: PROGRAM_ID,
        consumerTokenAccount,
        providerTokenAccount,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const [blockhash] = await context.banksClient.getLatestBlockhash();
    const tx = new Transaction();
    tx.add(ix);
    tx.recentBlockhash = blockhash;
    tx.feePayer = deployer.publicKey;
    tx.sign(deployer);
    const events = await decodeEvents(context, program, tx);
    const resolved = events.find((e) => e.name === "challengeResolved");
    expect(resolved, "expected ChallengeResolved event").to.not.be.undefined;
    expect(resolved!.data.defended).to.equal(false);

    const consumerBalanceAfter = await getTokenBalance(context, consumerTokenAccount);
    expect(Number(consumerBalanceAfter - consumerBalanceBefore)).to.equal(
      amount + amount // full escrow + challenge_stake (== job.amount) refunded
    );

    const agentAccount = await fetchAccount<any>(
      context,
      program,
      "agent",
      agentPda(provider.publicKey)
    );
    expect(agentAccount.scoreFailed.toNumber()).to.equal(1);
    expect(agentAccount.slashEvents).to.equal(1);
    expect(agentAccount.lastSlashSlot.toNumber()).to.be.greaterThan(0);
    expect(agentAccount.openJobs).to.equal(0);
    expect(agentAccount.stakeAmount.toNumber()).to.be.lessThan(STAKE);

    const jobOfferAccount = await fetchAccount<any>(context, program, "jobOffer", jobOffer);
    expect(jobOfferAccount.status).to.deep.equal({ burned: {} });

    expect(await accountExists(context, challenge)).to.equal(false);

    const poolAfter = await fetchAccount<any>(
      context,
      program,
      "slashingPool",
      slashingPoolPda()
    );
    expect(poolAfter.totalSlashed.toNumber()).to.be.greaterThan(
      poolBefore.totalSlashed.toNumber()
    );

    const slashedAmount = poolAfter.totalSlashed.toNumber() - poolBefore.totalSlashed.toNumber();
    expect(slashedAmount).to.equal(STAKE - agentAccount.stakeAmount.toNumber());
  });

  it("DEFENDED (MAD): both stakes burned, escrow split 50/50", async () => {
    const { owner: provider, tokenAccount: providerTokenAccount } = await registerAgent();
    const { consumer, consumerTokenAccount, jobId, jobOffer, escrowVault, amount } =
      await proposeAcceptRelease(provider, 0, TEST_DEFENSE_WINDOW);

    const { challenge, stakeVault } = await openChallenge(
      consumer,
      consumerTokenAccount,
      jobId,
      jobOffer,
      TEST_DEFENSE_WINDOW
    );

    const defendIx = await program.methods
      .defendChallenge(jobId)
      .accounts({
        jobOffer,
        challenge,
        stakeVault,
        providerTokenAccount,
        mint,
        provider: provider.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const [bh] = await context.banksClient.getLatestBlockhash();
    const defendTx = new Transaction();
    defendTx.add(defendIx);
    defendTx.recentBlockhash = bh;
    defendTx.feePayer = provider.publicKey;
    defendTx.sign(provider);
    const defendEvents = await decodeEvents(context, program, defendTx);
    expect(defendEvents.find((e) => e.name === "challengeDefended")).to.not.be.undefined;

    await warpSeconds(context, TEST_DEFENSE_WINDOW + 10);

    const consumerBalanceBefore = await getTokenBalance(context, consumerTokenAccount);
    const providerBalanceBefore = await getTokenBalance(context, providerTokenAccount);
    const poolBefore = await fetchAccount<any>(
      context,
      program,
      "slashingPool",
      slashingPoolPda()
    );

    const slashingVault = getAssociatedTokenAddressSync(mint, slashingPoolPda(), true);
    const providerStakeVault = getAssociatedTokenAddressSync(
      mint,
      agentPda(provider.publicKey),
      true
    );

    const resolveIx = await program.methods
      .resolveChallenge(jobId)
      .accounts({
        jobOffer,
        challenge,
        challenger: consumer.publicKey,
        escrowVault,
        challengeStakeVault: stakeVault,
        slashingPool: slashingPoolPda(),
        slashingPoolVault: slashingVault,
        providerAgent: agentPda(provider.publicKey),
        providerStakeVault,
        consumerAgent: PROGRAM_ID,
        consumerTokenAccount,
        providerTokenAccount,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const [bh2] = await context.banksClient.getLatestBlockhash();
    const resolveTx = new Transaction();
    resolveTx.add(resolveIx);
    resolveTx.recentBlockhash = bh2;
    resolveTx.feePayer = deployer.publicKey;
    resolveTx.sign(deployer);
    const resolveEvents = await decodeEvents(context, program, resolveTx);
    const resolved = resolveEvents.find((e) => e.name === "challengeResolved");
    expect(resolved, "expected ChallengeResolved event").to.not.be.undefined;
    expect(resolved!.data.defended).to.equal(true);

    const consumerBalanceAfter = await getTokenBalance(context, consumerTokenAccount);
    const providerBalanceAfter = await getTokenBalance(context, providerTokenAccount);
    expect(Number(consumerBalanceAfter - consumerBalanceBefore)).to.equal(Math.floor(amount / 2));
    expect(Number(providerBalanceAfter - providerBalanceBefore)).to.equal(
      amount - Math.floor(amount / 2)
    );

    const agentAccount = await fetchAccount<any>(
      context,
      program,
      "agent",
      agentPda(provider.publicKey)
    );
    expect(agentAccount.scoreFailed.toNumber()).to.equal(1);
    expect(agentAccount.openJobs).to.equal(0);
    // No additional stake slash beyond the burned defense stake — the staked
    // vault itself is untouched in the defended branch.
    expect(agentAccount.stakeAmount.toNumber()).to.equal(STAKE);

    const jobOfferAccount = await fetchAccount<any>(context, program, "jobOffer", jobOffer);
    expect(jobOfferAccount.status).to.deep.equal({ burned: {} });

    const poolAfter = await fetchAccount<any>(
      context,
      program,
      "slashingPool",
      slashingPoolPda()
    );
    expect(poolAfter.totalSlashed.toNumber() - poolBefore.totalSlashed.toNumber()).to.equal(
      amount + amount // challenge_stake + defense_stake, both == job.amount
    );
  });

  it("NEGATIVE: challenge_settlement after the challenge window closed fails", async () => {
    const { owner: provider } = await registerAgent();
    const { consumer, consumerTokenAccount, jobId, jobOffer } = await proposeAcceptRelease(
      provider,
      1,
      TEST_DEFENSE_WINDOW
    );

    await warpSeconds(context, 5);

    const challenge = challengePda(jobOffer);
    const stakeVault = getAssociatedTokenAddressSync(mint, challenge, true);
    const ix = await program.methods
      .challengeSettlement(jobId)
      .accounts({
        jobOffer,
        challenge,
        stakeVault,
        consumerTokenAccount,
        mint,
        consumer: consumer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const err = await sendExpectFail(context, [ix], consumer);
    expect(err).to.match(/ChallengeWindowClosed/);
  });

  it("NEGATIVE: defend_challenge by non-provider fails", async () => {
    const { owner: provider } = await registerAgent();
    const { consumer, consumerTokenAccount, jobId, jobOffer } = await proposeAcceptRelease(
      provider,
      60,
      TEST_DEFENSE_WINDOW
    );
    const { challenge, stakeVault } = await openChallenge(
      consumer,
      consumerTokenAccount,
      jobId,
      jobOffer,
      TEST_DEFENSE_WINDOW
    );

    const impostor = Keypair.generate();
    fundWallet(context, impostor.publicKey);
    const impostorTokenAccount = await createAtaAndMint(
      context,
      deployer,
      mint,
      impostor.publicKey,
      1_000_000
    );

    const ix = await program.methods
      .defendChallenge(jobId)
      .accounts({
        jobOffer,
        challenge,
        stakeVault,
        providerTokenAccount: impostorTokenAccount,
        mint,
        provider: impostor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const err = await sendExpectFail(context, [ix], impostor);
    expect(err).to.match(/NotProvider|ConstraintHasOne/);
  });

  it("NEGATIVE: defend_challenge after defense_deadline fails", async () => {
    const { owner: provider, tokenAccount: providerTokenAccount } = await registerAgent();
    const { consumer, consumerTokenAccount, jobId, jobOffer } = await proposeAcceptRelease(
      provider,
      60,
      TEST_DEFENSE_WINDOW
    );
    const { challenge, stakeVault } = await openChallenge(
      consumer,
      consumerTokenAccount,
      jobId,
      jobOffer,
      TEST_DEFENSE_WINDOW
    );

    await warpSeconds(context, TEST_DEFENSE_WINDOW + 10);

    const ix = await program.methods
      .defendChallenge(jobId)
      .accounts({
        jobOffer,
        challenge,
        stakeVault,
        providerTokenAccount,
        mint,
        provider: provider.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const err = await sendExpectFail(context, [ix], provider);
    expect(err).to.match(/DefenseDeadlinePassed/);
  });

  it("NEGATIVE: resolve_challenge before defense_deadline fails", async () => {
    const { owner: provider, tokenAccount: providerTokenAccount } = await registerAgent();
    const { consumer, consumerTokenAccount, jobId, jobOffer, escrowVault } =
      await proposeAcceptRelease(provider, 0, TEST_DEFENSE_WINDOW);
    const { challenge, stakeVault } = await openChallenge(
      consumer,
      consumerTokenAccount,
      jobId,
      jobOffer,
      TEST_DEFENSE_WINDOW
    );

    const slashingVault = getAssociatedTokenAddressSync(mint, slashingPoolPda(), true);
    const providerStakeVault = getAssociatedTokenAddressSync(
      mint,
      agentPda(provider.publicKey),
      true
    );

    const ix = await program.methods
      .resolveChallenge(jobId)
      .accounts({
        jobOffer,
        challenge,
        challenger: consumer.publicKey,
        escrowVault,
        challengeStakeVault: stakeVault,
        slashingPool: slashingPoolPda(),
        slashingPoolVault: slashingVault,
        providerAgent: agentPda(provider.publicKey),
        providerStakeVault,
        consumerAgent: PROGRAM_ID,
        consumerTokenAccount,
        providerTokenAccount,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const err = await sendExpectFail(context, [ix], deployer);
    expect(err).to.match(/DefenseWindowNotElapsed/);
  });

  it("NEGATIVE: challenge_settlement on a non-SettlementPending job fails", async () => {
    const { owner: provider } = await registerAgent();
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
    const amount = 1_000_000;
    const now = Math.floor(Date.now() / 1000);
    const jobOffer = jobOfferPda(consumer.publicKey, jobId);
    const escrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    await send(
      context,
      [
        await program.methods
          .proposeJob(jobId, provider.publicKey, new BN(amount), new BN(now + 3600), new BN(now + 7200), 0, TEST_DEFENSE_WINDOW)
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
    // Deliberately skip release_escrow — status stays Accepted, not SettlementPending.

    const challenge = challengePda(jobOffer);
    const stakeVault = getAssociatedTokenAddressSync(mint, challenge, true);
    const ix = await program.methods
      .challengeSettlement(jobId)
      .accounts({
        jobOffer,
        challenge,
        stakeVault,
        consumerTokenAccount,
        mint,
        consumer: consumer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const err = await sendExpectFail(context, [ix], consumer);
    expect(err).to.match(/InvalidStatus/);
  });
});
