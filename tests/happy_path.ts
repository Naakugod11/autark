import * as crypto from "crypto";
import { AnchorProvider, BN, Program, web3 } from "@anchor-lang/core";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Autark } from "../target/types/autark";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new web3.PublicKey(
  "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy"
);

const MIN_STAKE_AMOUNT = 10_000_000; // 10 USDC, 6 decimals

function mintWhitelistPda(): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint_whitelist")],
    PROGRAM_ID
  )[0];
}

function slashingPoolPda(): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("slashing_pool")],
    PROGRAM_ID
  )[0];
}

function agentPda(owner: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

function jobOfferPda(
  consumer: web3.PublicKey,
  jobId: number[]
): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("job"), consumer.toBuffer(), Buffer.from(jobId)],
    PROGRAM_ID
  )[0];
}

function randomJobId(): number[] {
  return Array.from(crypto.randomBytes(32));
}

// mint_whitelist and slashing_pool are global singletons shared by every test
// file in this mocha run (ts-mocha loads tests/**/*.ts alphabetically against
// one local validator). Whichever file's `before` hook runs first does the
// real init; later files just swallow the expected "already in use" error.
async function ignoreAlreadyInUse(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err: any) {
    if (!/already in use/i.test(err.toString())) throw err;
  }
}

async function airdrop(
  connection: web3.Connection,
  pubkey: web3.PublicKey,
  lamports: number
) {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig, "confirmed");
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("autark happy path: config + identity + stake + targeted hire", () => {
  const provider = AnchorProvider.env();
  const connection = provider.connection;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require("../target/idl/autark.json");
  const program = new Program<Autark>(idl, provider);

  const deployer = (provider.wallet as any).payer as web3.Keypair;

  let mint: web3.PublicKey;
  let unwhitelistedMint: web3.PublicKey;

  let consumer: web3.Keypair;
  let consumerTokenAccount: web3.PublicKey;

  let providerAgentOwner: web3.Keypair;
  let providerOwnerTokenAccount: web3.PublicKey;

  const INITIAL_STAKE = 50_000_000; // 50 USDC

  before(async () => {
    mint = await createMint(
      connection,
      deployer,
      deployer.publicKey,
      null,
      6
    );
    unwhitelistedMint = await createMint(
      connection,
      deployer,
      deployer.publicKey,
      null,
      6
    );

    consumer = web3.Keypair.generate();
    providerAgentOwner = web3.Keypair.generate();
    await airdrop(connection, consumer.publicKey, 2 * web3.LAMPORTS_PER_SOL);
    await airdrop(
      connection,
      providerAgentOwner.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );

    consumerTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        deployer,
        mint,
        consumer.publicKey
      )
    ).address;
    providerOwnerTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        deployer,
        mint,
        providerAgentOwner.publicKey
      )
    ).address;

    await mintTo(
      connection,
      deployer,
      mint,
      consumerTokenAccount,
      deployer,
      1_000_000_000
    );
    await mintTo(
      connection,
      deployer,
      mint,
      providerOwnerTokenAccount,
      deployer,
      1_000_000_000
    );

    // ── Config: deployer-only setup ──────────────────────────────────────────
    await ignoreAlreadyInUse(
      program.methods
        .initMintWhitelist()
        .accounts({
          mintWhitelist: mintWhitelistPda(),
          authority: deployer.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc()
    );

    await program.methods
      .addWhitelistedMint(mint)
      .accounts({
        mintWhitelist: mintWhitelistPda(),
        authority: deployer.publicKey,
      })
      .rpc();

    const slashingVault = getAssociatedTokenAddressSync(
      mint,
      slashingPoolPda(),
      true
    );
    await ignoreAlreadyInUse(
      program.methods
        .initSlashingPool()
        .accounts({
          mintWhitelist: mintWhitelistPda(),
          slashingPool: slashingPoolPda(),
          mint,
          vault: slashingVault,
          authority: deployer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc()
    );

    // ── Identity + stake: register the provider's Agent ──────────────────────
    const providerAgentStakeVault = getAssociatedTokenAddressSync(
      mint,
      agentPda(providerAgentOwner.publicKey),
      true
    );
    await program.methods
      .registerAgent(["wallet-analysis"], "https://provider.example.com", new BN(INITIAL_STAKE))
      .accounts({
        agent: agentPda(providerAgentOwner.publicKey),
        mintWhitelist: mintWhitelistPda(),
        mint,
        stakeVault: providerAgentStakeVault,
        ownerTokenAccount: providerOwnerTokenAccount,
        owner: providerAgentOwner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([providerAgentOwner])
      .rpc();
  });

  it("HAPPY: propose_job -> accept_job -> release_escrow -> claim_settlement", async () => {
    const jobId = randomJobId();
    const amount = 5_000_000; // 5 USDC
    const now = Math.floor(Date.now() / 1000);
    const acceptanceDeadline = now + 3600;
    const deliveryDeadline = now + 7200;
    const challengeWindowSeconds = 0; // no clock-warp needed

    const jobOffer = jobOfferPda(consumer.publicKey, jobId);
    const escrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    await program.methods
      .proposeJob(
        jobId,
        providerAgentOwner.publicKey,
        new BN(amount),
        new BN(acceptanceDeadline),
        new BN(deliveryDeadline),
        challengeWindowSeconds
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
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([consumer])
      .rpc();

    await program.methods
      .acceptJob(jobId)
      .accounts({
        jobOffer,
        agent: agentPda(providerAgentOwner.publicKey),
        provider: providerAgentOwner.publicKey,
      })
      .signers([providerAgentOwner])
      .rpc();

    await program.methods
      .releaseEscrow(jobId)
      .accounts({
        jobOffer,
        provider: providerAgentOwner.publicKey,
      })
      .signers([providerAgentOwner])
      .rpc();

    const balanceBefore = (await getAccount(connection, providerOwnerTokenAccount))
      .amount;

    await program.methods
      .claimSettlement(jobId)
      .accounts({
        jobOffer,
        providerAgent: agentPda(providerAgentOwner.publicKey),
        escrowVault,
        providerTokenAccount: providerOwnerTokenAccount,
        providerWallet: providerAgentOwner.publicKey,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const balanceAfter = (await getAccount(connection, providerOwnerTokenAccount))
      .amount;
    expect(Number(balanceAfter - balanceBefore)).to.equal(amount);

    const agentAccount = await program.account.agent.fetch(
      agentPda(providerAgentOwner.publicKey)
    );
    expect(agentAccount.scoreCompleted.toNumber()).to.equal(1);
    expect(agentAccount.scoreVolume.toNumber()).to.equal(amount);
    expect(agentAccount.openJobs).to.equal(0);

    const jobOfferAccount = await program.account.jobOffer.fetch(jobOffer);
    expect(jobOfferAccount.status).to.deep.equal({ settled: {} });
  });

  it("NEGATIVE: register_agent with stake < MIN_STAKE_AMOUNT fails", async () => {
    const lowStakeOwner = web3.Keypair.generate();
    await airdrop(connection, lowStakeOwner.publicKey, web3.LAMPORTS_PER_SOL);
    const lowStakeTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        deployer,
        mint,
        lowStakeOwner.publicKey
      )
    ).address;
    await mintTo(
      connection,
      deployer,
      mint,
      lowStakeTokenAccount,
      deployer,
      1_000_000
    );

    const stakeVault = getAssociatedTokenAddressSync(
      mint,
      agentPda(lowStakeOwner.publicKey),
      true
    );

    let threw = false;
    try {
      await program.methods
        .registerAgent(["x"], "https://low-stake.example.com", new BN(1_000_000))
        .accounts({
          agent: agentPda(lowStakeOwner.publicKey),
          mintWhitelist: mintWhitelistPda(),
          mint,
          stakeVault,
          ownerTokenAccount: lowStakeTokenAccount,
          owner: lowStakeOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([lowStakeOwner])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/StakeTooLow/);
    }
    expect(threw).to.be.true;
  });

  it("NEGATIVE: accept_job signed by a non-provider fails", async () => {
    // A second, legitimately registered agent that is NOT the intended provider.
    const impostor = web3.Keypair.generate();
    await airdrop(connection, impostor.publicKey, 2 * web3.LAMPORTS_PER_SOL);
    const impostorTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        deployer,
        mint,
        impostor.publicKey
      )
    ).address;
    await mintTo(
      connection,
      deployer,
      mint,
      impostorTokenAccount,
      deployer,
      1_000_000_000
    );
    const impostorStakeVault = getAssociatedTokenAddressSync(
      mint,
      agentPda(impostor.publicKey),
      true
    );
    await program.methods
      .registerAgent(["impostor"], "https://impostor.example.com", new BN(MIN_STAKE_AMOUNT))
      .accounts({
        agent: agentPda(impostor.publicKey),
        mintWhitelist: mintWhitelistPda(),
        mint,
        stakeVault: impostorStakeVault,
        ownerTokenAccount: impostorTokenAccount,
        owner: impostor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([impostor])
      .rpc();

    const jobId = randomJobId();
    const amount = 1_000_000;
    const now = Math.floor(Date.now() / 1000);
    const jobOffer = jobOfferPda(consumer.publicKey, jobId);
    const escrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    await program.methods
      .proposeJob(
        jobId,
        providerAgentOwner.publicKey,
        new BN(amount),
        new BN(now + 3600),
        new BN(now + 7200),
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
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([consumer])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .acceptJob(jobId)
        .accounts({
          jobOffer,
          agent: agentPda(impostor.publicKey),
          provider: impostor.publicKey,
        })
        .signers([impostor])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/NotProvider|ConstraintHasOne/);
    }
    expect(threw).to.be.true;
  });

  it("NEGATIVE: claim_settlement before the challenge window elapses fails", async () => {
    const jobId = randomJobId();
    const amount = 1_000_000;
    const now = Math.floor(Date.now() / 1000);
    const challengeWindowSeconds = 30;
    const jobOffer = jobOfferPda(consumer.publicKey, jobId);
    const escrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    await program.methods
      .proposeJob(
        jobId,
        providerAgentOwner.publicKey,
        new BN(amount),
        new BN(now + 3600),
        new BN(now + 7200),
        challengeWindowSeconds
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
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([consumer])
      .rpc();

    await program.methods
      .acceptJob(jobId)
      .accounts({
        jobOffer,
        agent: agentPda(providerAgentOwner.publicKey),
        provider: providerAgentOwner.publicKey,
      })
      .signers([providerAgentOwner])
      .rpc();

    await program.methods
      .releaseEscrow(jobId)
      .accounts({
        jobOffer,
        provider: providerAgentOwner.publicKey,
      })
      .signers([providerAgentOwner])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .claimSettlement(jobId)
        .accounts({
          jobOffer,
          providerAgent: agentPda(providerAgentOwner.publicKey),
          escrowVault,
          providerTokenAccount: providerOwnerTokenAccount,
          providerWallet: providerAgentOwner.publicKey,
          mint,
          cranker: deployer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/ChallengeWindowNotElapsed/);
    }
    expect(threw).to.be.true;
  });

  it("NEGATIVE: propose_job with a non-whitelisted mint fails", async () => {
    const jobId = randomJobId();
    const jobOffer = jobOfferPda(consumer.publicKey, jobId);
    const escrowVault = getAssociatedTokenAddressSync(
      unwhitelistedMint,
      jobOffer,
      true
    );
    const consumerBadMintAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        deployer,
        unwhitelistedMint,
        consumer.publicKey
      )
    ).address;
    await mintTo(
      connection,
      deployer,
      unwhitelistedMint,
      consumerBadMintAccount,
      deployer,
      1_000_000_000
    );

    const now = Math.floor(Date.now() / 1000);
    let threw = false;
    try {
      await program.methods
        .proposeJob(
          jobId,
          providerAgentOwner.publicKey,
          new BN(1_000_000),
          new BN(now + 3600),
          new BN(now + 7200),
          0
        )
        .accounts({
          jobOffer,
          mintWhitelist: mintWhitelistPda(),
          mint: unwhitelistedMint,
          escrowVault,
          consumerTokenAccount: consumerBadMintAccount,
          consumer: consumer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([consumer])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/MintNotWhitelisted/);
    }
    expect(threw).to.be.true;
  });

  it("NEGATIVE: stake_withdraw with open_jobs > 0 fails", async () => {
    const jobId = randomJobId();
    const amount = 1_000_000;
    const now = Math.floor(Date.now() / 1000);
    const jobOffer = jobOfferPda(consumer.publicKey, jobId);
    const escrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    await program.methods
      .proposeJob(
        jobId,
        providerAgentOwner.publicKey,
        new BN(amount),
        new BN(now + 3600),
        new BN(now + 7200),
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
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([consumer])
      .rpc();

    await program.methods
      .acceptJob(jobId)
      .accounts({
        jobOffer,
        agent: agentPda(providerAgentOwner.publicKey),
        provider: providerAgentOwner.publicKey,
      })
      .signers([providerAgentOwner])
      .rpc();

    const stakeVault = getAssociatedTokenAddressSync(
      mint,
      agentPda(providerAgentOwner.publicKey),
      true
    );

    let threw = false;
    try {
      await program.methods
        .stakeWithdraw(new BN(1_000_000))
        .accounts({
          agent: agentPda(providerAgentOwner.publicKey),
          stakeVault,
          ownerTokenAccount: providerOwnerTokenAccount,
          owner: providerAgentOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([providerAgentOwner])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/AgentHasOpenJobs/);
    }
    expect(threw).to.be.true;

    // Clean up: settle this job so it doesn't leave dangling state for other tests.
    await program.methods
      .releaseEscrow(jobId)
      .accounts({
        jobOffer,
        provider: providerAgentOwner.publicKey,
      })
      .signers([providerAgentOwner])
      .rpc();
    await program.methods
      .claimSettlement(jobId)
      .accounts({
        jobOffer,
        providerAgent: agentPda(providerAgentOwner.publicKey),
        escrowVault,
        providerTokenAccount: providerOwnerTokenAccount,
        providerWallet: providerAgentOwner.publicKey,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  });
});
