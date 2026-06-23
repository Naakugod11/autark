// Tier 3 reputation-lifecycle test. Runs against solana-bankrun for the same
// reason as dispute.ts. The undefended-challenge leg needs to fast-forward
// past the job's defense window — a per-job param (defense_window_seconds)
// since the Tier 2.5 fix, not a hardcoded constant — and bankrun's
// `ProgramTestContext.setClock()` does that without a real wait. We pass a
// short TEST_DEFENSE_WINDOW below to keep the warp trivial.
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
} from "@solana/spl-token";
import { expect } from "chai";
import { Clock, ProgramTestContext, startAnchor } from "solana-bankrun";
import { Autark } from "../target/types/autark";

const PROGRAM_ID = new PublicKey(
  "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy"
);

const TEST_DEFENSE_WINDOW = 5;

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

function challengePda(job: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("challenge"), job.toBuffer()],
    PROGRAM_ID
  )[0];
}

function bountyPda(poster: PublicKey, bountyId: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bounty"), poster.toBuffer(), Buffer.from(bountyId)],
    PROGRAM_ID
  )[0];
}

function bidPda(bounty: PublicKey, bidder: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), bounty.toBuffer(), bidder.toBuffer()],
    PROGRAM_ID
  )[0];
}

function awardedJobOfferPda(poster: PublicKey, bounty: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), poster.toBuffer(), bounty.toBuffer()],
    PROGRAM_ID
  )[0];
}

function randomId(): number[] {
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

// Sends a single instruction and decodes every emitted event from the logs.
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

describe("autark reputation: counters accumulate across the full arc", () => {
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

  async function settleAJob(amount: number): Promise<{ name: string; data: any }[]> {
    const consumer = Keypair.generate();
    fundWallet(context, consumer.publicKey);
    const consumerTokenAccount = await createAtaAndMint(
      context,
      deployer,
      mint,
      consumer.publicKey,
      1_000_000_000
    );

    const jobId = randomId();
    const now = Math.floor(Date.now() / 1000);
    const jobOffer = jobOfferPda(consumer.publicKey, jobId);
    const escrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    const proposeIx = await program.methods
      .proposeJob(jobId, provider.publicKey, new BN(amount), new BN(now + 3600), new BN(now + 7200), 0, 0)
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
      .instruction();
    const proposeEvents = await sendCapturingEvents(context, program, proposeIx, consumer);
    const proposed = findEvent(proposeEvents, "jobProposed");
    expect(proposed.amount.toNumber()).to.equal(amount);
    expect(proposed.provider.toBase58()).to.equal(provider.publicKey.toBase58());

    const acceptIx = await program.methods
      .acceptJob(jobId)
      .accounts({
        jobOffer,
        agent: agentPda(provider.publicKey),
        provider: provider.publicKey,
      })
      .instruction();
    const acceptEvents = await sendCapturingEvents(context, program, acceptIx, provider);
    const accepted = findEvent(acceptEvents, "jobAccepted");
    expect(accepted.amount.toNumber()).to.equal(amount);

    const releaseIx = await program.methods
      .releaseEscrow(jobId)
      .accounts({
        jobOffer,
        provider: provider.publicKey,
      })
      .instruction();
    const releaseEvents = await sendCapturingEvents(context, program, releaseIx, provider);
    const pending = findEvent(releaseEvents, "settlementPendingEvent");
    expect(pending.provider.toBase58()).to.equal(provider.publicKey.toBase58());

    const claimIx = await program.methods
      .claimSettlement(jobId)
      .accounts({
        jobOffer,
        providerAgent: agentPda(provider.publicKey),
        escrowVault,
        providerTokenAccount,
        providerWallet: provider.publicKey,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    return sendCapturingEvents(context, program, claimIx, deployer);
  }

  async function loseAnUndefendedChallenge(amount: number): Promise<{ name: string; data: any }[]> {
    const consumer = Keypair.generate();
    fundWallet(context, consumer.publicKey);
    const consumerTokenAccount = await createAtaAndMint(
      context,
      deployer,
      mint,
      consumer.publicKey,
      1_000_000_000
    );

    const jobId = randomId();
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

    const challenge = challengePda(jobOffer);
    const stakeVault = getAssociatedTokenAddressSync(mint, challenge, true);
    await send(
      context,
      [
        await program.methods
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
          .instruction(),
      ],
      consumer
    );

    // Proves defense_deadline derives from the per-job param passed to
    // propose_job, not from a hardcoded program constant.
    const challengeAccount = await fetchAccount<any>(context, program, "challenge", challenge);
    expect(challengeAccount.defenseDeadline.toNumber()).to.equal(
      challengeAccount.openedAt.toNumber() + TEST_DEFENSE_WINDOW
    );

    await warpSeconds(context, TEST_DEFENSE_WINDOW + 10);

    const slashingVault = getAssociatedTokenAddressSync(mint, slashingPoolPda(), true);
    const providerStakeVault = getAssociatedTokenAddressSync(mint, agentPda(provider.publicKey), true);
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
    return sendCapturingEvents(context, program, resolveIx, deployer);
  }

  it("settles two jobs then loses a challenge — counters accumulate, never roll back", async () => {
    const amount1 = 5_000_000;
    const amount2 = 3_000_000;
    const amount3 = 4_000_000;

    // ── Step 1: first settled job ────────────────────────────────────────────
    const settle1Events = await settleAJob(amount1);
    const settled1 = findEvent(settle1Events, "jobSettled");
    expect(settled1.amount.toNumber()).to.equal(amount1);
    expect(settled1.scoreCompleted.toNumber()).to.equal(1);
    expect(settled1.scoreVolume.toNumber()).to.equal(amount1);
    expect(settled1.scoreFailed.toNumber()).to.equal(0);

    let agent = await fetchAccount<any>(context, program, "agent", agentPda(provider.publicKey));
    expect(agent.scoreCompleted.toNumber()).to.equal(1);
    expect(agent.scoreVolume.toNumber()).to.equal(amount1);
    expect(agent.scoreFailed.toNumber()).to.equal(0);
    expect(agent.openJobs).to.equal(0);
    // event == state
    expect(settled1.scoreCompleted.toNumber()).to.equal(agent.scoreCompleted.toNumber());
    expect(settled1.scoreVolume.toNumber()).to.equal(agent.scoreVolume.toNumber());
    expect(settled1.scoreFailed.toNumber()).to.equal(agent.scoreFailed.toNumber());

    // ── Step 2: second settled job ───────────────────────────────────────────
    const settle2Events = await settleAJob(amount2);
    const settled2 = findEvent(settle2Events, "jobSettled");
    expect(settled2.scoreCompleted.toNumber()).to.equal(2);
    expect(settled2.scoreVolume.toNumber()).to.equal(amount1 + amount2);
    expect(settled2.scoreFailed.toNumber()).to.equal(0);

    agent = await fetchAccount<any>(context, program, "agent", agentPda(provider.publicKey));
    expect(agent.scoreCompleted.toNumber()).to.equal(2);
    expect(agent.scoreVolume.toNumber()).to.equal(amount1 + amount2);
    expect(agent.scoreFailed.toNumber()).to.equal(0);
    expect(agent.slashEvents).to.equal(0);
    expect(agent.openJobs).to.equal(0);
    expect(settled2.scoreCompleted.toNumber()).to.equal(agent.scoreCompleted.toNumber());
    expect(settled2.scoreVolume.toNumber()).to.equal(agent.scoreVolume.toNumber());
    expect(settled2.scoreFailed.toNumber()).to.equal(agent.scoreFailed.toNumber());

    // ── Step 3: lose an undefended challenge on a third job ─────────────────
    const stakeBeforeSlash = agent.stakeAmount.toNumber();
    const resolveEvents = await loseAnUndefendedChallenge(amount3);
    const resolved = findEvent(resolveEvents, "challengeResolved");
    expect(resolved.defended).to.equal(false);

    agent = await fetchAccount<any>(context, program, "agent", agentPda(provider.publicKey));
    expect(agent.scoreFailed.toNumber()).to.equal(1);
    expect(agent.slashEvents).to.equal(1);
    expect(agent.lastSlashSlot.toNumber()).to.be.greaterThan(0);
    expect(agent.stakeAmount.toNumber()).to.be.lessThan(stakeBeforeSlash);
    expect(agent.openJobs).to.equal(0);

    // score_completed/score_volume are NOT rolled back by the slash.
    expect(agent.scoreCompleted.toNumber()).to.equal(2);
    expect(agent.scoreVolume.toNumber()).to.equal(amount1 + amount2);

    // event == state, including the dramatic counter-move fields.
    expect(resolved.providerScoreCompleted.toNumber()).to.equal(agent.scoreCompleted.toNumber());
    expect(resolved.providerScoreVolume.toNumber()).to.equal(agent.scoreVolume.toNumber());
    expect(resolved.providerScoreFailed.toNumber()).to.equal(agent.scoreFailed.toNumber());
    expect(resolved.providerScoreCompleted.toNumber()).to.equal(2);
    expect(resolved.providerScoreVolume.toNumber()).to.equal(amount1 + amount2);
    expect(resolved.providerScoreFailed.toNumber()).to.equal(1);
  });

  it("post_bounty/submit_bid/accept_bid emit BountyPosted/BidSubmitted/BountyAwarded", async () => {
    const bountyId = randomId();
    const maxAmount = 10_000_000;
    const price = 6_000_000;
    const now = Math.floor(Date.now() / 1000);
    const bounty = bountyPda(provider.publicKey, bountyId); // reuse `provider` wallet as poster here
    const bountyEscrowVault = getAssociatedTokenAddressSync(mint, bounty, true);

    const postIx = await program.methods
      .postBounty(
        bountyId,
        "wallet-analysis",
        new BN(maxAmount),
        0,
        new BN(now + 3600),
        new BN(now + 7200),
        0,
        0
      )
      .accounts({
        bounty,
        mintWhitelist: mintWhitelistPda(),
        mint,
        escrowVault: bountyEscrowVault,
        posterTokenAccount: providerTokenAccount,
        poster: provider.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const postEvents = await sendCapturingEvents(context, program, postIx, provider);
    const posted = findEvent(postEvents, "bountyPosted");
    expect(posted.maxAmount.toNumber()).to.equal(maxAmount);
    expect(posted.capabilityRequired).to.equal("wallet-analysis");

    // A second agent bids — the bidder must be a different registered Agent
    // than the poster.
    const bidder = Keypair.generate();
    fundWallet(context, bidder.publicKey);
    const bidderTokenAccount = await createAtaAndMint(
      context,
      deployer,
      mint,
      bidder.publicKey,
      1_000_000_000
    );
    const bidderStakeVault = getAssociatedTokenAddressSync(mint, agentPda(bidder.publicKey), true);
    await send(
      context,
      [
        await program.methods
          .registerAgent(["wallet-analysis"], "https://bidder.example.com", new BN(STAKE))
          .accounts({
            agent: agentPda(bidder.publicKey),
            mintWhitelist: mintWhitelistPda(),
            mint,
            stakeVault: bidderStakeVault,
            ownerTokenAccount: bidderTokenAccount,
            owner: bidder.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ],
      bidder
    );

    const bid = bidPda(bounty, bidder.publicKey);
    const bidIx = await program.methods
      .submitBid(new BN(price), new BN(now + 7200))
      .accounts({
        bounty,
        bidderAgent: agentPda(bidder.publicKey),
        bid,
        bidder: bidder.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const bidEvents = await sendCapturingEvents(context, program, bidIx, bidder);
    const submitted = findEvent(bidEvents, "bidSubmitted");
    expect(submitted.price.toNumber()).to.equal(price);
    expect(submitted.bidder.toBase58()).to.equal(bidder.publicKey.toBase58());

    const jobOffer = awardedJobOfferPda(provider.publicKey, bounty);
    const jobEscrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);
    const acceptIx = await program.methods
      .acceptBid(bountyId)
      .accounts({
        bounty,
        bid,
        jobOffer,
        jobEscrowVault,
        bountyEscrowVault,
        posterTokenAccount: providerTokenAccount,
        providerAgent: agentPda(bidder.publicKey),
        mint,
        poster: provider.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const acceptEvents = await sendCapturingEvents(context, program, acceptIx, provider);
    const awarded = findEvent(acceptEvents, "bountyAwarded");
    expect(awarded.price.toNumber()).to.equal(price);
    expect(awarded.refundToPoster.toNumber()).to.equal(maxAmount - price);
    expect(awarded.provider.toBase58()).to.equal(bidder.publicKey.toBase58());
    expect(awarded.poster.toBase58()).to.equal(provider.publicKey.toBase58());
  });
});
