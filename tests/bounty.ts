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

function bountyPda(poster: web3.PublicKey, bountyId: number[]): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bounty"), poster.toBuffer(), Buffer.from(bountyId)],
    PROGRAM_ID
  )[0];
}

function bidPda(bounty: web3.PublicKey, bidder: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), bounty.toBuffer(), bidder.toBuffer()],
    PROGRAM_ID
  )[0];
}

// The awarded JobOffer's PDA seed is the bounty's own pubkey bytes (one
// awarded job per bounty) — same ["job", consumer, job_id_32] scheme as
// targeted-hire jobs.
function awardedJobOfferPda(
  poster: web3.PublicKey,
  bounty: web3.PublicKey
): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("job"), poster.toBuffer(), bounty.toBuffer()],
    PROGRAM_ID
  )[0];
}

function randomId(): number[] {
  return Array.from(crypto.randomBytes(32));
}

async function airdrop(
  connection: web3.Connection,
  pubkey: web3.PublicKey,
  lamports: number
) {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig, "confirmed");
}

// mint_whitelist and slashing_pool are global singletons shared by every test
// file in this mocha run. Whichever file's `before` hook runs first does the
// real init; later files just swallow the expected "already in use" error.
async function ignoreAlreadyInUse(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err: any) {
    if (!/already in use/i.test(err.toString())) throw err;
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("autark bounty: broadcast / bounty happy path", () => {
  const provider = AnchorProvider.env();
  const connection = provider.connection;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require("../target/idl/autark.json");
  const program = new Program<Autark>(idl, provider);

  const deployer = (provider.wallet as any).payer as web3.Keypair;

  let mint: web3.PublicKey;

  let poster: web3.Keypair;
  let posterTokenAccount: web3.PublicKey;

  let bidder: web3.Keypair;
  let bidderTokenAccount: web3.PublicKey;

  const INITIAL_STAKE = 50_000_000; // 50 USDC

  async function registerFreshAgent(
    capabilities: string[],
    endpointUrl: string,
    initialStake: number
  ): Promise<{ owner: web3.Keypair; tokenAccount: web3.PublicKey }> {
    const owner = web3.Keypair.generate();
    await airdrop(connection, owner.publicKey, 2 * web3.LAMPORTS_PER_SOL);
    const tokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        deployer,
        mint,
        owner.publicKey
      )
    ).address;
    await mintTo(connection, deployer, mint, tokenAccount, deployer, 1_000_000_000);

    const stakeVault = getAssociatedTokenAddressSync(mint, agentPda(owner.publicKey), true);
    await program.methods
      .registerAgent(capabilities, endpointUrl, new BN(initialStake))
      .accounts({
        agent: agentPda(owner.publicKey),
        mintWhitelist: mintWhitelistPda(),
        mint,
        stakeVault,
        ownerTokenAccount: tokenAccount,
        owner: owner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    return { owner, tokenAccount };
  }

  before(async () => {
    mint = await createMint(connection, deployer, deployer.publicKey, null, 6);

    poster = web3.Keypair.generate();
    bidder = web3.Keypair.generate();
    await airdrop(connection, poster.publicKey, 2 * web3.LAMPORTS_PER_SOL);
    await airdrop(connection, bidder.publicKey, 2 * web3.LAMPORTS_PER_SOL);

    posterTokenAccount = (
      await getOrCreateAssociatedTokenAccount(connection, deployer, mint, poster.publicKey)
    ).address;
    bidderTokenAccount = (
      await getOrCreateAssociatedTokenAccount(connection, deployer, mint, bidder.publicKey)
    ).address;

    await mintTo(connection, deployer, mint, posterTokenAccount, deployer, 1_000_000_000);
    await mintTo(connection, deployer, mint, bidderTokenAccount, deployer, 1_000_000_000);

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

    const slashingVault = getAssociatedTokenAddressSync(mint, slashingPoolPda(), true);
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

    const stakeVault = getAssociatedTokenAddressSync(mint, agentPda(bidder.publicKey), true);
    await program.methods
      .registerAgent(["wallet-analysis"], "https://bidder.example.com", new BN(INITIAL_STAKE))
      .accounts({
        agent: agentPda(bidder.publicKey),
        mintWhitelist: mintWhitelistPda(),
        mint,
        stakeVault,
        ownerTokenAccount: bidderTokenAccount,
        owner: bidder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();
  });

  it("HAPPY: post_bounty -> submit_bid -> accept_bid -> release_escrow -> claim_settlement", async () => {
    const bountyId = randomId();
    const maxAmount = 10_000_000; // 10 USDC
    const price = 6_000_000; // 6 USDC
    const now = Math.floor(Date.now() / 1000);
    const biddingDeadline = now + 3600;
    const deliveryDeadline = now + 7200;
    const challengeWindowSeconds = 0; // no clock-warp needed

    const bounty = bountyPda(poster.publicKey, bountyId);
    const bountyEscrowVault = getAssociatedTokenAddressSync(mint, bounty, true);

    await program.methods
      .postBounty(
        bountyId,
        "wallet-analysis",
        new BN(maxAmount),
        0, // min_reputation — a freshly registered agent (score_completed = 0) qualifies
        new BN(biddingDeadline),
        new BN(deliveryDeadline),
        challengeWindowSeconds,
        0
      )
      .accounts({
        bounty,
        mintWhitelist: mintWhitelistPda(),
        mint,
        escrowVault: bountyEscrowVault,
        posterTokenAccount,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([poster])
      .rpc();

    const bid = bidPda(bounty, bidder.publicKey);
    await program.methods
      .submitBid(new BN(price), new BN(deliveryDeadline))
      .accounts({
        bounty,
        bidderAgent: agentPda(bidder.publicKey),
        bid,
        bidder: bidder.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    const posterBalanceBeforeAccept = (
      await getAccount(connection, posterTokenAccount)
    ).amount;

    const jobOffer = awardedJobOfferPda(poster.publicKey, bounty);
    const jobEscrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    await program.methods
      .acceptBid(bountyId)
      .accounts({
        bounty,
        bid,
        jobOffer,
        jobEscrowVault,
        bountyEscrowVault,
        posterTokenAccount,
        providerAgent: agentPda(bidder.publicKey),
        mint,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([poster])
      .rpc();

    const posterBalanceAfterAccept = (
      await getAccount(connection, posterTokenAccount)
    ).amount;
    expect(Number(posterBalanceAfterAccept - posterBalanceBeforeAccept)).to.equal(
      maxAmount - price
    );

    const bountyAfterAccept = await program.account.bounty.fetch(bounty);
    expect(bountyAfterAccept.status).to.deep.equal({ awarded: {} });

    const jobIdBytes = Array.from(bounty.toBytes());

    // Settlement through the EXISTING, unchanged Tier 1a instructions.
    await program.methods
      .releaseEscrow(jobIdBytes)
      .accounts({
        jobOffer,
        provider: bidder.publicKey,
      })
      .signers([bidder])
      .rpc();

    const bidderBalanceBeforeClaim = (
      await getAccount(connection, bidderTokenAccount)
    ).amount;

    await program.methods
      .claimSettlement(jobIdBytes)
      .accounts({
        jobOffer,
        providerAgent: agentPda(bidder.publicKey),
        escrowVault: jobEscrowVault,
        providerTokenAccount: bidderTokenAccount,
        providerWallet: bidder.publicKey,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const bidderBalanceAfterClaim = (
      await getAccount(connection, bidderTokenAccount)
    ).amount;
    expect(Number(bidderBalanceAfterClaim - bidderBalanceBeforeClaim)).to.equal(price);

    const agentAccount = await program.account.agent.fetch(agentPda(bidder.publicKey));
    expect(agentAccount.scoreCompleted.toNumber()).to.equal(1);
    expect(agentAccount.scoreVolume.toNumber()).to.equal(price);
    expect(agentAccount.openJobs).to.equal(0);

    const jobOfferAccount = await program.account.jobOffer.fetch(jobOffer);
    expect(jobOfferAccount.status).to.deep.equal({ settled: {} });
    // job_id for a bounty-awarded job is the bounty's own pubkey bytes.
    expect(Array.from(jobOfferAccount.jobId as number[])).to.deep.equal(
      Array.from(bounty.toBytes())
    );
  });

  it("NEGATIVE: bid price > max_amount fails", async () => {
    const bountyId = randomId();
    const maxAmount = 1_000_000;
    const now = Math.floor(Date.now() / 1000);
    const bounty = bountyPda(poster.publicKey, bountyId);
    const bountyEscrowVault = getAssociatedTokenAddressSync(mint, bounty, true);

    await program.methods
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
        posterTokenAccount,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([poster])
      .rpc();

    const bid = bidPda(bounty, bidder.publicKey);
    let threw = false;
    try {
      await program.methods
        .submitBid(new BN(maxAmount + 1), new BN(now + 7200))
        .accounts({
          bounty,
          bidderAgent: agentPda(bidder.publicKey),
          bid,
          bidder: bidder.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([bidder])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/BidPriceTooHigh/);
    }
    expect(threw).to.be.true;
  });

  it("NEGATIVE: bidder under min_reputation fails", async () => {
    const bountyId = randomId();
    const maxAmount = 1_000_000;
    const now = Math.floor(Date.now() / 1000);
    const bounty = bountyPda(poster.publicKey, bountyId);
    const bountyEscrowVault = getAssociatedTokenAddressSync(mint, bounty, true);

    await program.methods
      .postBounty(
        bountyId,
        "wallet-analysis",
        new BN(maxAmount),
        1, // min_reputation = 1; a fresh agent has score_completed = 0
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
        posterTokenAccount,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([poster])
      .rpc();

    const { owner: lowRepBidder } = await registerFreshAgent(
      ["low-rep"],
      "https://low-rep.example.com",
      INITIAL_STAKE
    );

    const bid = bidPda(bounty, lowRepBidder.publicKey);
    let threw = false;
    try {
      await program.methods
        .submitBid(new BN(maxAmount), new BN(now + 7200))
        .accounts({
          bounty,
          bidderAgent: agentPda(lowRepBidder.publicKey),
          bid,
          bidder: lowRepBidder.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([lowRepBidder])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/ReputationTooLow/);
    }
    expect(threw).to.be.true;
  });

  it("NEGATIVE: accept_bid by non-poster fails", async () => {
    const bountyId = randomId();
    const maxAmount = 1_000_000;
    const price = 500_000;
    const now = Math.floor(Date.now() / 1000);
    const bounty = bountyPda(poster.publicKey, bountyId);
    const bountyEscrowVault = getAssociatedTokenAddressSync(mint, bounty, true);

    await program.methods
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
        posterTokenAccount,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([poster])
      .rpc();

    const bid = bidPda(bounty, bidder.publicKey);
    await program.methods
      .submitBid(new BN(price), new BN(now + 7200))
      .accounts({
        bounty,
        bidderAgent: agentPda(bidder.publicKey),
        bid,
        bidder: bidder.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    const impostorPoster = web3.Keypair.generate();
    await airdrop(connection, impostorPoster.publicKey, web3.LAMPORTS_PER_SOL);
    const impostorTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        deployer,
        mint,
        impostorPoster.publicKey
      )
    ).address;

    const jobOffer = awardedJobOfferPda(poster.publicKey, bounty);
    const jobEscrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    let threw = false;
    try {
      await program.methods
        .acceptBid(bountyId)
        .accounts({
          bounty,
          bid,
          jobOffer,
          jobEscrowVault,
          bountyEscrowVault,
          posterTokenAccount: impostorTokenAccount,
          providerAgent: agentPda(bidder.publicKey),
          mint,
          poster: impostorPoster.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([impostorPoster])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/Unauthorized|ConstraintHasOne|ConstraintSeeds/);
    }
    expect(threw).to.be.true;
  });

  it("NEGATIVE: cancel_bounty after a bid is accepted fails", async () => {
    const bountyId = randomId();
    const maxAmount = 1_000_000;
    const price = 500_000;
    const now = Math.floor(Date.now() / 1000);
    const bounty = bountyPda(poster.publicKey, bountyId);
    const bountyEscrowVault = getAssociatedTokenAddressSync(mint, bounty, true);

    await program.methods
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
        posterTokenAccount,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([poster])
      .rpc();

    const bid = bidPda(bounty, bidder.publicKey);
    await program.methods
      .submitBid(new BN(price), new BN(now + 7200))
      .accounts({
        bounty,
        bidderAgent: agentPda(bidder.publicKey),
        bid,
        bidder: bidder.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    const jobOffer = awardedJobOfferPda(poster.publicKey, bounty);
    const jobEscrowVault = getAssociatedTokenAddressSync(mint, jobOffer, true);

    await program.methods
      .acceptBid(bountyId)
      .accounts({
        bounty,
        bid,
        jobOffer,
        jobEscrowVault,
        bountyEscrowVault,
        posterTokenAccount,
        providerAgent: agentPda(bidder.publicKey),
        mint,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([poster])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .cancelBounty(bountyId)
        .accounts({
          bounty,
          escrowVault: bountyEscrowVault,
          posterTokenAccount,
          mint,
          poster: poster.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([poster])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/InvalidStatus|AccountNotInitialized/);
    }
    expect(threw).to.be.true;

    // Clean up: settle this job through the unchanged Tier 1a path so it
    // doesn't leave dangling state for other tests.
    await program.methods
      .releaseEscrow(Array.from(bounty.toBytes()))
      .accounts({
        jobOffer,
        provider: bidder.publicKey,
      })
      .signers([bidder])
      .rpc();
    await program.methods
      .claimSettlement(Array.from(bounty.toBytes()))
      .accounts({
        jobOffer,
        providerAgent: agentPda(bidder.publicKey),
        escrowVault: jobEscrowVault,
        providerTokenAccount: bidderTokenAccount,
        providerWallet: bidder.publicKey,
        mint,
        cranker: deployer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  });

  it("NEGATIVE: submit_bid after bidding_deadline fails", async () => {
    const bountyId = randomId();
    const maxAmount = 1_000_000;
    const now = Math.floor(Date.now() / 1000);
    const bounty = bountyPda(poster.publicKey, bountyId);
    const bountyEscrowVault = getAssociatedTokenAddressSync(mint, bounty, true);

    await program.methods
      .postBounty(
        bountyId,
        "wallet-analysis",
        new BN(maxAmount),
        0,
        new BN(now - 10), // bidding window already closed
        new BN(now + 7200),
        0,
        0
      )
      .accounts({
        bounty,
        mintWhitelist: mintWhitelistPda(),
        mint,
        escrowVault: bountyEscrowVault,
        posterTokenAccount,
        poster: poster.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([poster])
      .rpc();

    const bid = bidPda(bounty, bidder.publicKey);
    let threw = false;
    try {
      await program.methods
        .submitBid(new BN(maxAmount), new BN(now + 7200))
        .accounts({
          bounty,
          bidderAgent: agentPda(bidder.publicKey),
          bid,
          bidder: bidder.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([bidder])
        .rpc();
    } catch (err: any) {
      threw = true;
      expect(err.toString()).to.match(/DeadlinePassed/);
    }
    expect(threw).to.be.true;
  });
});
