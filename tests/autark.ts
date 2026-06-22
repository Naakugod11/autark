import { AnchorProvider, BN, Program, web3 } from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
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

function agentPda(owner: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

function jobOfferPda(consumer: web3.PublicKey, jobId: number[]): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("job"), consumer.toBuffer(), Buffer.from(jobId)],
    PROGRAM_ID
  )[0];
}

// allowOwnerOffCurve = true because the authority (job_offer) is a PDA.
function escrowAta(jobOffer: web3.PublicKey, mint: web3.PublicKey): web3.PublicKey {
  return getAssociatedTokenAddressSync(mint, jobOffer, true);
}

function randomJobId(): number[] {
  const buf = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

// Returns the validator's current unix_timestamp. Use this instead of nowSec()
// when setting on-chain deadlines — surfpool's clock can lag JS wall time by
// 10-30s on a cold start, causing JobNotExpired failures even after sleeping.
async function chainNow(connection: web3.Connection): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  const t = await connection.getBlockTime(slot);
  if (t === null) throw new Error("getBlockTime returned null");
  return t;
}

// Anchor 1.0's TypeScript .accounts() type uses a strict union that rejects
// object literals with multiple properties via excess property checking.
// Cast through `any` — runtime behavior is correct; we lose TS checking only
// on account names (which the program itself validates).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const accs = (obj: Record<string, unknown>) => obj as any;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("autark", () => {
  const provider = AnchorProvider.env();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require("../target/idl/autark.json");
  const program = new Program<Autark>(idl, provider);

  const payer = (provider.wallet as any).payer as web3.Keypair;
  const conn = provider.connection;

  const providerWallet = web3.Keypair.generate();
  const consumerWallet = web3.Keypair.generate();

  let usdcMint: web3.PublicKey;
  let providerUsdcAta: web3.PublicKey;
  let consumerUsdcAta: web3.PublicKey;

  const INITIAL_CONSUMER_USDC = 100_000_000; // 100 USDC (6 decimals)
  const INITIAL_PROVIDER_USDC = 10_000_000;  //  10 USDC

  // ── Global fixture ─────────────────────────────────────────────────────────

  before("fund wallets, create fake USDC mint, seed balances", async () => {
    const fundTx = new web3.Transaction()
      .add(web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: providerWallet.publicKey,
        lamports: 2 * web3.LAMPORTS_PER_SOL,
      }))
      .add(web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: consumerWallet.publicKey,
        lamports: 2 * web3.LAMPORTS_PER_SOL,
      }));
    await provider.sendAndConfirm(fundTx, [payer]);
    console.log("  ✔ funded providerWallet:", providerWallet.publicKey.toBase58());
    console.log("  ✔ funded consumerWallet:", consumerWallet.publicKey.toBase58());

    usdcMint = await createMint(conn, payer, payer.publicKey, null, 6);
    console.log("  ✔ fake USDC mint:", usdcMint.toBase58());

    providerUsdcAta = (await getOrCreateAssociatedTokenAccount(
      conn, payer, usdcMint, providerWallet.publicKey
    )).address;
    consumerUsdcAta = (await getOrCreateAssociatedTokenAccount(
      conn, payer, usdcMint, consumerWallet.publicKey
    )).address;

    await mintTo(conn, payer, usdcMint, consumerUsdcAta, payer, INITIAL_CONSUMER_USDC);
    await mintTo(conn, payer, usdcMint, providerUsdcAta, payer, INITIAL_PROVIDER_USDC);
    console.log(`  ✔ consumer: ${INITIAL_CONSUMER_USDC / 1e6} USDC`);
    console.log(`  ✔ provider: ${INITIAL_PROVIDER_USDC / 1e6} USDC`);
  });

  // ── register_agent ─────────────────────────────────────────────────────────

  describe("register_agent", () => {
    it("registers the provider agent", async () => {
      const agentAddr = agentPda(providerWallet.publicKey);

      await program.methods
        .registerAgent("TestProvider", "text-generation", "https://provider.example.com", new BN(1_000_000))
        .accounts(accs({
          agent: agentAddr,
          owner: providerWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([providerWallet])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentAddr);
      console.log(`  provider agent: name="${agent.name}" capability="${agent.capability}"`);
      expect(agent.name).to.equal("TestProvider");
      expect(agent.capability).to.equal("text-generation");
      expect(agent.owner.toBase58()).to.equal(providerWallet.publicKey.toBase58());
    });

    // A consumer agent PDA is not required by propose_job — the instruction only
    // validates the PROVIDER's agent PDA. Registering one here just verifies
    // the instruction works for any owner key.
    it("registers the consumer agent (optional — not required for job flow)", async () => {
      const agentAddr = agentPda(consumerWallet.publicKey);

      await program.methods
        .registerAgent("TestConsumer", "data-analysis", "https://consumer.example.com", new BN(0))
        .accounts(accs({
          agent: agentAddr,
          owner: consumerWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([consumerWallet])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentAddr);
      expect(agent.name).to.equal("TestConsumer");
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe("happy path: propose → accept → release", () => {
    const jobId = randomJobId();
    const OFFER_AMOUNT = 5_000_000; // 5 USDC

    let jobOffer: web3.PublicKey;
    let escrow: web3.PublicKey;

    before("compute PDAs", () => {
      jobOffer = jobOfferPda(consumerWallet.publicKey, jobId);
      escrow = escrowAta(jobOffer, usdcMint);
    });

    it("propose_job: USDC moves from consumer ATA to escrow ATA", async () => {
      const consumerBefore = (await getAccount(conn, consumerUsdcAta)).amount;

      await program.methods
        .proposeJob(
          jobId,
          new BN(OFFER_AMOUNT),
          new BN(nowSec() + 60),   // acceptance_deadline: 60s
          new BN(nowSec() + 300)   // delivery_deadline: 5 min
        )
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          providerAgent: agentPda(providerWallet.publicKey),
          consumerTokenAccount: consumerUsdcAta,
          consumer: consumerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([consumerWallet])
        .rpc();

      const consumerAfter = (await getAccount(conn, consumerUsdcAta)).amount;
      const escrowBalance = (await getAccount(conn, escrow)).amount;
      const offer = await program.account.jobOffer.fetch(jobOffer);

      console.log(`  consumer USDC: ${consumerBefore} → ${consumerAfter}`);
      console.log(`  escrow USDC:   ${escrowBalance}`);
      console.log(`  job status:    ${JSON.stringify(offer.status)}`);

      expect(Number(consumerAfter)).to.equal(Number(consumerBefore) - OFFER_AMOUNT);
      expect(Number(escrowBalance)).to.equal(OFFER_AMOUNT);
      expect(offer.status).to.deep.equal({ proposed: {} });
      expect(offer.offerAmount.toNumber()).to.equal(OFFER_AMOUNT);
    });

    it("accept_job: status moves to Accepted", async () => {
      await program.methods
        .acceptJob(jobId)
        .accounts(accs({
          jobOffer,
          provider: providerWallet.publicKey,
        }))
        .signers([providerWallet])
        .rpc();

      const offer = await program.account.jobOffer.fetch(jobOffer);
      console.log(`  job status: ${JSON.stringify(offer.status)}`);
      expect(offer.status).to.deep.equal({ accepted: {} });
    });

    it("release_escrow: USDC reaches provider ATA, status is Settled", async () => {
      const providerBefore = (await getAccount(conn, providerUsdcAta)).amount;
      const resultHash = Array.from(Buffer.alloc(32, 0xab)); // dummy 32-byte hash

      await program.methods
        .releaseEscrow(jobId, resultHash)
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          providerTokenAccount: providerUsdcAta,
          provider: providerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([providerWallet])
        .rpc();

      const providerAfter = (await getAccount(conn, providerUsdcAta)).amount;
      const escrowAfter = (await getAccount(conn, escrow)).amount;
      const offer = await program.account.jobOffer.fetch(jobOffer);

      console.log(`  provider USDC: ${providerBefore} → ${providerAfter} (+${Number(providerAfter) - Number(providerBefore)})`);
      console.log(`  escrow USDC:   ${escrowAfter}`);
      console.log(`  job status:    ${JSON.stringify(offer.status)}`);
      console.log(`  result_hash:   ${offer.resultHash ? "set" : "null"}`);

      expect(Number(providerAfter)).to.equal(Number(providerBefore) + OFFER_AMOUNT);
      expect(Number(escrowAfter)).to.equal(0);
      expect(offer.status).to.deep.equal({ settled: {} });
      expect(offer.resultHash).to.not.be.null;
    });
  });

  // ── Negative: reject_job ───────────────────────────────────────────────────

  describe("reject_job: provider declines, consumer refunded", () => {
    const jobId = randomJobId();
    const OFFER_AMOUNT = 2_000_000; // 2 USDC

    let jobOffer: web3.PublicKey;
    let escrow: web3.PublicKey;

    before("propose the job", async () => {
      jobOffer = jobOfferPda(consumerWallet.publicKey, jobId);
      escrow = escrowAta(jobOffer, usdcMint);

      await program.methods
        .proposeJob(jobId, new BN(OFFER_AMOUNT), new BN(nowSec() + 60), new BN(nowSec() + 300))
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          providerAgent: agentPda(providerWallet.publicKey),
          consumerTokenAccount: consumerUsdcAta,
          consumer: consumerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([consumerWallet])
        .rpc();
    });

    it("reject_job: USDC refunded to consumer, status is Rejected", async () => {
      const consumerBefore = (await getAccount(conn, consumerUsdcAta)).amount;

      await program.methods
        .rejectJob(jobId)
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          consumerTokenAccount: consumerUsdcAta,
          consumer: consumerWallet.publicKey,
          provider: providerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([providerWallet])
        .rpc();

      const consumerAfter = (await getAccount(conn, consumerUsdcAta)).amount;
      const escrowAfter = (await getAccount(conn, escrow)).amount;
      const offer = await program.account.jobOffer.fetch(jobOffer);

      console.log(`  consumer USDC: ${consumerBefore} → ${consumerAfter} (+${Number(consumerAfter) - Number(consumerBefore)})`);
      console.log(`  escrow USDC:   ${escrowAfter}`);
      console.log(`  job status:    ${JSON.stringify(offer.status)}`);

      expect(Number(consumerAfter)).to.equal(Number(consumerBefore) + OFFER_AMOUNT);
      expect(Number(escrowAfter)).to.equal(0);
      expect(offer.status).to.deep.equal({ rejected: {} });
    });
  });

  // ── Negative: cancel after acceptance_deadline (Proposed path) ─────────────

  describe("cancel_expired_job (Proposed): consumer reclaims after acceptance deadline", () => {
    const jobId = randomJobId();
    const OFFER_AMOUNT = 1_000_000;

    let jobOffer: web3.PublicKey;
    let escrow: web3.PublicKey;

    before("propose with 3s acceptance deadline, wait for expiry", async () => {
      jobOffer = jobOfferPda(consumerWallet.publicKey, jobId);
      escrow = escrowAta(jobOffer, usdcMint);

      const now1 = await chainNow(conn);
      await program.methods
        .proposeJob(jobId, new BN(OFFER_AMOUNT), new BN(now1 + 8), new BN(now1 + 60))
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          providerAgent: agentPda(providerWallet.publicKey),
          consumerTokenAccount: consumerUsdcAta,
          consumer: consumerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([consumerWallet])
        .rpc();

      console.log("  waiting 10s for acceptance_deadline to pass...");
      await sleep(10000);
    });

    it("cancel_expired_job (Proposed): status=Expired, USDC refunded", async () => {
      const consumerBefore = (await getAccount(conn, consumerUsdcAta)).amount;

      await program.methods
        .cancelExpiredJob(jobId)
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          consumerTokenAccount: consumerUsdcAta,
          consumer: consumerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([consumerWallet])
        .rpc();

      const consumerAfter = (await getAccount(conn, consumerUsdcAta)).amount;
      const offer = await program.account.jobOffer.fetch(jobOffer);

      console.log(`  consumer USDC: ${consumerBefore} → ${consumerAfter}`);
      console.log(`  job status:    ${JSON.stringify(offer.status)}`);

      expect(Number(consumerAfter)).to.equal(Number(consumerBefore) + OFFER_AMOUNT);
      expect(offer.status).to.deep.equal({ expired: {} });
    });
  });

  // ── Negative: cancel after delivery_deadline (Accepted path) ──────────────

  describe("cancel_expired_job (Accepted): consumer reclaims after delivery deadline", () => {
    const jobId = randomJobId();
    const OFFER_AMOUNT = 1_500_000;

    let jobOffer: web3.PublicKey;
    let escrow: web3.PublicKey;

    before("propose + accept with 5s delivery deadline, wait for expiry", async () => {
      jobOffer = jobOfferPda(consumerWallet.publicKey, jobId);
      escrow = escrowAta(jobOffer, usdcMint);

      // delivery_deadline MUST be > acceptance_deadline (program enforces this).
      // Keep both short: accept within 3s, then wait past delivery at +14s.
      const now2 = await chainNow(conn);
      await program.methods
        .proposeJob(jobId, new BN(OFFER_AMOUNT), new BN(now2 + 8), new BN(now2 + 14))
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          providerAgent: agentPda(providerWallet.publicKey),
          consumerTokenAccount: consumerUsdcAta,
          consumer: consumerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([consumerWallet])
        .rpc();

      await program.methods
        .acceptJob(jobId)
        .accounts(accs({ jobOffer, provider: providerWallet.publicKey }))
        .signers([providerWallet])
        .rpc();

      console.log("  provider accepted; waiting 16s for delivery_deadline to pass...");
      await sleep(16000);
    });

    it("cancel_expired_job (Accepted): status=Expired, USDC refunded to consumer", async () => {
      const consumerBefore = (await getAccount(conn, consumerUsdcAta)).amount;

      await program.methods
        .cancelExpiredJob(jobId)
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          consumerTokenAccount: consumerUsdcAta,
          consumer: consumerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([consumerWallet])
        .rpc();

      const consumerAfter = (await getAccount(conn, consumerUsdcAta)).amount;
      const offer = await program.account.jobOffer.fetch(jobOffer);

      console.log(`  consumer USDC: ${consumerBefore} → ${consumerAfter}`);
      console.log(`  job status:    ${JSON.stringify(offer.status)}`);

      expect(Number(consumerAfter)).to.equal(Number(consumerBefore) + OFFER_AMOUNT);
      expect(offer.status).to.deep.equal({ expired: {} });
    });
  });

  // ── Auth failures ──────────────────────────────────────────────────────────

  describe("auth failures", () => {
    const jobId = randomJobId();
    const OFFER_AMOUNT = 500_000;

    let jobOffer: web3.PublicKey;
    let escrow: web3.PublicKey;
    const imposter = web3.Keypair.generate();

    before("fund imposter, propose a job", async () => {
      const fundTx = new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: imposter.publicKey,
          lamports: web3.LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(fundTx, [payer]);

      jobOffer = jobOfferPda(consumerWallet.publicKey, jobId);
      escrow = escrowAta(jobOffer, usdcMint);

      await program.methods
        .proposeJob(jobId, new BN(OFFER_AMOUNT), new BN(nowSec() + 120), new BN(nowSec() + 600))
        .accounts(accs({
          jobOffer,
          escrowTokenAccount: escrow,
          providerAgent: agentPda(providerWallet.publicKey),
          consumerTokenAccount: consumerUsdcAta,
          consumer: consumerWallet.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        }))
        .signers([consumerWallet])
        .rpc();
    });

    it("imposter cannot accept_job — has_one = provider fires ConstraintHasOne", async () => {
      let threw = false;
      try {
        await program.methods
          .acceptJob(jobId)
          .accounts(accs({ jobOffer, provider: imposter.publicKey }))
          .signers([imposter])
          .rpc();
      } catch (e: any) {
        threw = true;
        const logs: string[] = e?.logs ?? [];
        console.log("  rejected (expected):", e?.message?.slice(0, 100));
        // Anchor encodes has_one violations as error 2003 (ConstraintHasOne).
        const blocked = logs.some((l) =>
          l.includes("ConstraintHasOne") || l.includes("2003") || l.includes("InvalidProvider")
        );
        expect(blocked, "expected ConstraintHasOne in program logs").to.be.true;
      }
      expect(threw, "expected tx to be rejected").to.be.true;
    });

    it("imposter cannot release_escrow — has_one = provider fires ConstraintHasOne", async () => {
      // Legitimate provider accepts first so status is Accepted.
      await program.methods
        .acceptJob(jobId)
        .accounts(accs({ jobOffer, provider: providerWallet.publicKey }))
        .signers([providerWallet])
        .rpc();

      let threw = false;
      const resultHash = Array.from(Buffer.alloc(32, 0x00));
      try {
        await program.methods
          .releaseEscrow(jobId, resultHash)
          .accounts(accs({
            jobOffer,
            escrowTokenAccount: escrow,
            providerTokenAccount: providerUsdcAta,
            provider: imposter.publicKey, // wrong signer
            usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: web3.SystemProgram.programId,
          }))
          .signers([imposter])
          .rpc();
      } catch (e: any) {
        threw = true;
        const logs: string[] = e?.logs ?? [];
        console.log("  rejected (expected):", e?.message?.slice(0, 100));
        const blocked = logs.some((l) =>
          l.includes("ConstraintHasOne") || l.includes("2003") || l.includes("InvalidProvider")
        );
        expect(blocked, "expected ConstraintHasOne in program logs").to.be.true;
      }
      expect(threw, "expected tx to be rejected").to.be.true;
    });
  });
});
