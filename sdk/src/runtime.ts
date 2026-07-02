/**
 * sdk/src/runtime.ts — AutarkAgent
 *
 * Reusable polling-based agent runtime. Implementors provide only `onJob`
 * (the intelligence function); all Solana mechanics live here.
 *
 * Discovery: job_id is now stored on-chain in JobOffer.job_id (added in the
 * v1.1 contract upgrade). A provider memcmp scan at offset 40 returns all
 * targeted-hire and bounty-awarded jobs; consumer + job_id are read directly
 * off each account, so no out-of-band hint is required.
 */

import { BN } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AutarkClient } from "./client";
import { agentPda } from "./pdas";
import {
  JobOfferData,
  ChallengeData,
  JobStatus,
  ChallengeState,
  fetchJobOffer,
} from "./types";

// ── Public types ───────────────────────────────────────────────────────────────

export type OnJobResult =
  | { deliver: true; result: string }
  | { decline: true };

export type AgentRuntimeConfig = {
  keypair: Keypair;
  capabilities: string[];
  endpointUrl: string;
  mint: PublicKey;
  minStake?: number;       // whole USDC, default 20 (MIN_STAKE on-chain is 10)
  minPrice?: number;       // whole USDC, ignore jobs below this, default 0
  pollIntervalMs?: number; // default 4000
  onJob: (job: JobOfferData) => Promise<OnJobResult>;
  onChallenged?: (
    job: JobOfferData,
    challenge: ChallengeData
  ) => Promise<"defend" | "concede">;
};

// ── AutarkAgent ────────────────────────────────────────────────────────────────

export class AutarkAgent {
  private readonly cfg: Required<AgentRuntimeConfig>;
  private readonly client: AutarkClient;
  readonly me: PublicKey;
  get connection() { return this.client.connection; }

  private intervalId?: ReturnType<typeof setInterval>;
  private running = false;

  // Dedup: job/challenge pubkeys we have already acted on this session.
  // TODO: these sets grow unboundedly in long-lived processes; prune settled
  // accounts periodically in a production runtime.
  private readonly handledJobs = new Set<string>();
  private readonly handledSettlements = new Set<string>(); // 'settle:<jobKey>'
  private readonly handledDefenses = new Set<string>();    // 'defend:<challengeKey>'

  // In-memory result store. v1: result delivery is off-chain/trust-based;
  // releaseEscrow is the "delivered" signal. On-chain result hashing is v2.
  readonly jobResults = new Map<string, string>(); // jobPubkey → result text

  constructor(config: AgentRuntimeConfig) {
    this.cfg = {
      minStake: 20,
      minPrice: 0,
      pollIntervalMs: 4000,
      onChallenged: async () => "defend",
      ...config,
    };
    this.client = AutarkClient.fromKeypair(config.keypair);
    this.me = config.keypair.publicKey;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this._preflight();
    await this._ensureRegistered();
    this.running = true;
    this.intervalId = setInterval(() => {
      this._pollOnce().catch((e) => {
        // Isolate one bad iteration so the loop survives.
        console.error(
          "[AutarkAgent] poll error (loop continues):",
          e?.message ?? e
        );
      });
    }, this.cfg.pollIntervalMs);
    console.log(
      `[AutarkAgent] Running. Polling every ${this.cfg.pollIntervalMs}ms — ${this.me.toBase58().slice(0, 8)}…`
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.running = false;
    console.log("[AutarkAgent] Stopped.");
  }

  status() {
    return {
      running: this.running,
      pubkey: this.me.toBase58(),
      handledJobs: this.handledJobs.size,
      resultsStored: this.jobResults.size,
    };
  }

  // ── Lifecycle internals ────────────────────────────────────────────────────

  private async _preflight(): Promise<void> {
    const conn = this.client.connection;

    // SOL balance
    const sol = await conn.getBalance(this.me);
    if (sol < 0.05 * LAMPORTS_PER_SOL) {
      throw new Error(
        `Insufficient SOL: ${(sol / LAMPORTS_PER_SOL).toFixed(4)} SOL on ` +
          `${this.me.toBase58()}. Fund with ≥0.05 SOL for fees.`
      );
    }

    // USDC balance — using getTokenAccountBalance; treats missing ATA as 0
    const ata = getAssociatedTokenAddressSync(this.cfg.mint, this.me, false);
    let usdcBalance = 0;
    try {
      const bal = await conn.getTokenAccountBalance(ata);
      usdcBalance = bal.value.uiAmount ?? 0;
    } catch {
      // ATA not yet created → 0
    }
    if (usdcBalance < this.cfg.minStake) {
      throw new Error(
        `Insufficient USDC: ${usdcBalance} in ${ata.toBase58().slice(0, 8)}…. ` +
          `Need ≥${this.cfg.minStake} USDC to register with minStake. ` +
          `Mint test USDC to ${this.me.toBase58()} first.`
      );
    }

    console.log(
      `[AutarkAgent] Preflight OK — SOL: ${(sol / LAMPORTS_PER_SOL).toFixed(3)}, USDC: ${usdcBalance}`
    );
  }

  private async _ensureRegistered(): Promise<void> {
    const agent = agentPda(this.me);
    const existing = await this.client.connection.getAccountInfo(agent);
    if (existing) {
      console.log(
        `[AutarkAgent] Agent PDA already registered: ${agent.toBase58().slice(0, 8)}…`
      );
      return;
    }
    console.log("[AutarkAgent] Registering agent…");
    const sig = await this._sendWithRetry("registerAgent", () =>
      this.client.ix
        .registerAgent({
          capabilities: this.cfg.capabilities,
          endpointUrl: this.cfg.endpointUrl,
          initialStake: this.cfg.minStake,
          mint: this.cfg.mint,
        })
        .rpc()
    );
    console.log(`[AutarkAgent] Registered: ${sig}`);
  }

  // ── Poll loop ──────────────────────────────────────────────────────────────

  private async _pollOnce(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Single RPC call: fetch all my jobs (filter by provider == me).
    // Status is filtered in JS — avoids byte-offset fragility of a second memcmp.
    // Offset 40 = 8 discriminator + 32 consumer; provider is always at this
    // offset because job_id was appended at the END of the JobOffer struct.
    const myJobs = await this.client.program.account.jobOffer.all([
      {
        memcmp: {
          offset: 40,
          bytes: this.me.toBase58(),
        },
      },
    ]);

    // ── a. Incoming proposed jobs ──────────────────────────────────────────
    for (const raw of myJobs) {
      const r: any = raw.account;
      const status = Object.keys(r.status)[0] as JobStatus;
      if (status !== "proposed") continue;
      if ((r.acceptanceDeadline as BN).toNumber() < now) continue; // stale

      const jobKey = raw.publicKey.toBase58();
      if (this.handledJobs.has(jobKey)) continue;

      // Extract consumer and job_id directly from the on-chain account.
      const consumer: PublicKey = r.consumer;
      const jobId: number[] = Array.from(r.jobId as number[]);

      // Pre-upgrade accounts (created before job_id was added) have job_id = zeros.
      // Cannot re-derive their PDA, so skip them.
      if (jobId.every(b => b === 0)) continue;

      // Mark handled before async work so concurrent poll iterations don't double-fire.
      this.handledJobs.add(jobKey);

      const job = this._decodeJobOffer(raw.publicKey, r);

      // Price filter
      if (job.amount / 1_000_000 < this.cfg.minPrice) {
        console.log(
          `[AutarkAgent] Job ${jobKey.slice(0, 8)}… below minPrice (${job.amount / 1_000_000} USDC), rejecting`
        );
        await this._sendWithRetry("rejectJob", () =>
          this.client.ix
            .rejectJob({
              consumer,
              jobId,
              mint: job.mint,
            })
            .rpc()
        ).catch((e) =>
          console.error("[AutarkAgent] rejectJob failed:", e?.message)
        );
        continue;
      }

      // Call the intelligence function
      let result: OnJobResult;
      try {
        result = await this.cfg.onJob(job);
      } catch (e: any) {
        console.error(
          `[AutarkAgent] onJob threw for ${jobKey.slice(0, 8)}…:`,
          e?.message ?? e
        );
        result = { decline: true };
      }

      if ("decline" in result) {
        await this._sendWithRetry("rejectJob-decline", () =>
          this.client.ix
            .rejectJob({
              consumer,
              jobId,
              mint: job.mint,
            })
            .rpc()
        ).catch((e) =>
          console.error("[AutarkAgent] rejectJob(decline) failed:", e?.message)
        );
      } else {
        // v1: accept then release. Result is stored in-memory and logged;
        // there is no on-chain result commitment in this version.
        const acceptSig = await this._sendWithRetry("acceptJob", () =>
          this.client.ix
            .acceptJob({ consumer, jobId })
            .rpc()
        );
        const releaseSig = await this._sendWithRetry("releaseEscrow", () =>
          this.client.ix
            .releaseEscrow({ consumer, jobId })
            .rpc()
        );
        this.jobResults.set(jobKey, result.result);
        console.log(
          `[AutarkAgent] ✓ Job ${jobKey.slice(0, 8)}… delivered` +
            ` | accept=${acceptSig.slice(0, 8)}… release=${releaseSig.slice(0, 8)}…`
        );
        console.log(
          `[AutarkAgent]   Result preview: ${result.result.slice(0, 120)}…`
        );
      }
    }

    // ── b. Self-crank settlement ───────────────────────────────────────────
    for (const raw of myJobs) {
      const r: any = raw.account;
      const status = Object.keys(r.status)[0] as JobStatus;
      if (status !== "settlementPending") continue;

      const jobKey = raw.publicKey.toBase58();
      const settleKey = "settle:" + jobKey;
      if (this.handledSettlements.has(settleKey)) continue;

      // Check challenge window has elapsed
      const settlementPendingAt = r.settlementPendingAt
        ? (r.settlementPendingAt as BN).toNumber()
        : null;
      if (settlementPendingAt === null) continue;
      const challengeDeadline =
        settlementPendingAt + (r.challengeWindowSeconds as number);
      if (challengeDeadline > now) continue; // window still open

      const consumer: PublicKey = r.consumer;
      const jobId: number[] = Array.from(r.jobId as number[]);

      // Pre-upgrade accounts have job_id = [0,0,...] — can't re-derive PDA.
      if (jobId.every(b => b === 0)) {
        this.handledSettlements.add(settleKey);
        console.log(`[AutarkAgent] Skipping pre-upgrade job ${jobKey.slice(0, 8)}… (job_id not stored)`);
        continue;
      }

      const job = this._decodeJobOffer(raw.publicKey, r);

      const sig = await this._sendWithRetry("claimSettlement", () =>
        this.client.ix
          .claimSettlement({
            consumer,
            jobId,
            providerWallet: this.me,
            mint: job.mint,
          })
          .rpc()
      );
      // Mark handled only after confirmed success — a program error (e.g.
      // ChallengeWindowNotElapsed if clocks drift) must not permanently prevent retry.
      this.handledSettlements.add(settleKey);
      console.log(
        `[AutarkAgent] ✓ Claimed settlement for ${jobKey.slice(0, 8)}… | ${sig.slice(0, 8)}…`
      );
    }

    // ── c. Defend challenges ───────────────────────────────────────────────
    // Single RPC call: fetch all challenges where defender == me, filter state in JS.
    const myChallenges = await this.client.program.account.challenge.all([
      {
        memcmp: {
          // Challenge layout: 8 discriminator + 32 job + 32 challenger = offset 72 for defender
          offset: 72,
          bytes: this.me.toBase58(),
        },
      },
    ]);

    for (const raw of myChallenges) {
      const r: any = raw.account;
      const state = Object.keys(r.state)[0] as ChallengeState;
      if (state !== "open") continue;

      const challengeKey = raw.publicKey.toBase58();
      const defendKey = "defend:" + challengeKey;
      if (this.handledDefenses.has(defendKey)) continue;

      const defenseDeadline = (r.defenseDeadline as BN).toNumber();
      if (defenseDeadline < now) {
        // Defense window expired — mark as handled and skip (already lost or conceded).
        this.handledDefenses.add(defendKey);
        continue;
      }

      const jobPubkey: PublicKey = r.job;
      // Fetch the job to read consumer + job_id from the on-chain account.
      const job = await fetchJobOffer(this.client.program, jobPubkey);
      const consumer = job.consumer;
      const jobId = job.jobId;

      // Pre-upgrade jobs have job_id = zeros — cannot defend them on-chain.
      if (jobId.every(b => b === 0)) {
        this.handledDefenses.add(defendKey);
        console.log(`[AutarkAgent] Skipping pre-upgrade challenge ${challengeKey.slice(0, 8)}… (job_id not stored)`);
        continue;
      }

      const challenge = this._decodeChallenge(raw.publicKey, r);

      let decision: "defend" | "concede";
      try {
        decision = await this.cfg.onChallenged(job, challenge);
      } catch (e: any) {
        console.error(
          `[AutarkAgent] onChallenged threw: ${e?.message ?? e} — defending`
        );
        decision = "defend";
      }

      if (decision === "defend") {
        const sig = await this._sendWithRetry("defendChallenge", () =>
          this.client.ix
            .defendChallenge({
              consumer,
              jobId,
              mint: job.mint,
            })
            .rpc()
        );
        // Mark handled only after tx confirms so a transient failure allows retry.
        this.handledDefenses.add(defendKey);
        console.log(
          `[AutarkAgent] ✓ Defended challenge ${challengeKey.slice(0, 8)}… | ${sig.slice(0, 8)}…`
        );
      } else {
        this.handledDefenses.add(defendKey);
        console.log(
          `[AutarkAgent] Conceding challenge ${challengeKey.slice(0, 8)}…`
        );
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async _sendWithRetry(
    label: string,
    fn: () => Promise<string>
  ): Promise<string> {
    for (let i = 0; i < 5; i++) {
      try {
        return await fn();
      } catch (e: any) {
        if (i === 4) throw e;
        const msg = String(e?.message ?? e);
        const transient =
          msg.includes("Blockhash not found") ||
          msg.includes("block height exceeded") ||
          msg.includes("timeout") ||
          msg.includes("429");
        if (!transient) throw e;
        const delay = 2_500 * (i + 1);
        console.log(
          `[AutarkAgent] [${label}] transient, retry ${i + 1}/5 in ${delay}ms`
        );
        await sleep(delay);
      }
    }
    throw new Error("unreachable");
  }

  private _decodeJobOffer(pubkey: PublicKey, r: any): JobOfferData {
    return {
      pubkey,
      consumer: r.consumer,
      provider: r.provider,
      mint: r.mint,
      amount: (r.amount as BN).toNumber(),
      escrowVault: r.escrowVault,
      status: Object.keys(r.status)[0] as JobStatus,
      budgetEscrow: r.budgetEscrow ?? null,
      depth: r.depth,
      parentJob: r.parentJob ?? null,
      acceptanceDeadline: (r.acceptanceDeadline as BN).toNumber(),
      deliveryDeadline: (r.deliveryDeadline as BN).toNumber(),
      challengeWindowSeconds: r.challengeWindowSeconds,
      defenseWindowSeconds: r.defenseWindowSeconds,
      settlementPendingAt: r.settlementPendingAt
        ? (r.settlementPendingAt as BN).toNumber()
        : null,
      counterCount: r.counterCount,
      providerStakeLocked: (r.providerStakeLocked as BN).toNumber(),
      createdAt: (r.createdAt as BN).toNumber(),
      bump: r.bump,
      jobId: Array.from(r.jobId as number[]),
    };
  }

  private _decodeChallenge(pubkey: PublicKey, r: any): ChallengeData {
    return {
      pubkey,
      job: r.job,
      challenger: r.challenger,
      defender: r.defender,
      mint: r.mint,
      stakeVault: r.stakeVault,
      challengeStake: (r.challengeStake as BN).toNumber(),
      defenseStake: (r.defenseStake as BN).toNumber(),
      state: Object.keys(r.state)[0] as ChallengeState,
      openedAt: (r.openedAt as BN).toNumber(),
      defenseDeadline: (r.defenseDeadline as BN).toNumber(),
      defendedAt: (r.defendedAt as BN).toNumber(),
      bump: r.bump,
    };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
