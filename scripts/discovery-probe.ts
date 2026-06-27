/**
 * scripts/discovery-probe.ts
 *
 * Probes whether a provider can discover targeted jobs via a memcmp scan on
 * JobOffer.provider — WITHOUT knowing job_id out-of-band.
 *
 * Run:  npx tsx scripts/discovery-probe.ts
 */

import "dotenv/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { BN } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { AutarkClient } from "../sdk/src/client";
import { agentPda, jobOfferPda } from "../sdk/src/pdas";

// ── Setup ─────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, "..");
const DEPLOYER_PATH =
  process.env.WALLET_KEYPAIR_PATH ??
  path.join(process.env.HOME ?? "~", ".config/solana/id.json");
const CONSUMER_PATH = path.join(REPO_ROOT, ".devnet/agent-wallet-2.json");
const PROVIDER_PATH = path.join(REPO_ROOT, ".devnet/agent-wallet-1.json");
const CONFIG_PATH = path.join(REPO_ROOT, "devnet.config.json");

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(p, "utf-8")))
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 5; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i === 4) throw e;
      const msg = String(e?.message ?? e);
      if (!msg.includes("Blockhash not found") && !msg.includes("block height exceeded") && !msg.includes("429")) throw e;
      await new Promise(r => setTimeout(r, 2_500 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

// ── Offset table (verified from IDL, not assumed) ─────────────────────────────
//
// JobOffer field layout (Borsh, all fixed-size):
//   offset   0: [discriminator]  8 bytes
//   offset   8: consumer         pubkey  32 bytes
//   offset  40: provider         pubkey  32 bytes   ← FILTER TARGET
//   offset  72: mint             pubkey  32 bytes
//   offset 104: amount           u64      8 bytes
//   offset 112: escrow_vault     pubkey  32 bytes
//   offset 144: status           enum     1 byte     (Proposed=0, Accepted=2, SettlementPending=3, …)
//   ...
//
// All fields before provider are fixed-size, so offset 40 is exact regardless
// of account content.

const PROVIDER_OFFSET = 40;
const STATUS_OFFSET   = 144;
const PROPOSED_BYTE   = 0; // JobStatus::Proposed = variant 0

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const testMint = new PublicKey(config.testMint);

  const deployer  = loadKeypair(DEPLOYER_PATH);
  const consumer  = loadKeypair(CONSUMER_PATH);
  const provider  = loadKeypair(PROVIDER_PATH);

  const consumerClient = AutarkClient.fromKeypair(consumer);
  const conn = consumerClient.connection;

  console.log("=== Autark discovery probe ===");
  console.log(`Provider (agent-wallet-1): ${provider.publicKey.toBase58()}`);
  console.log(`Consumer (agent-wallet-2): ${consumer.publicKey.toBase58()}`);
  console.log(`Offset used for provider field: ${PROVIDER_OFFSET}`);

  // ── Verify provider is a registered agent ────────────────────────────────
  const providerAgentPda = agentPda(provider.publicKey);
  const agentAcct = await conn.getAccountInfo(providerAgentPda);
  if (!agentAcct) {
    throw new Error("Provider agent not registered — run smoke-devnet.ts first to register agent-wallet-1");
  }
  console.log(`Agent PDA: ${providerAgentPda.toBase58()} (registered ✓)`);

  // ── Propose a job to the provider — consumer does NOT share job_id ───────
  // job_id is 32 random bytes — the consumer "knows" it but we will NOT pass
  // it to the discovery phase, simulating a provider that only knows its pubkey.
  const jobId = crypto.randomBytes(32);
  const expectedPda = jobOfferPda(consumer.publicKey, jobId);
  const now = Math.floor(Date.now() / 1000);

  console.log(`\nProposing job to provider (job_id hidden from discovery phase)…`);
  console.log(`Expected PDA: ${expectedPda.toBase58()}`);

  const proposeSig = await withRetry("proposeJob", () =>
    consumerClient.ix
      .proposeJob({
        jobId,
        provider: provider.publicKey,
        amount: 0.5,
        acceptanceDeadline: now + 3600,
        deliveryDeadline: now + 7200,
        challengeWindowSeconds: 60,
        defenseWindowSeconds: 60,
        mint: testMint,
      })
      .rpc()
  );
  console.log(`proposeJob tx: ${proposeSig}`);

  // Brief confirmation wait
  await new Promise(r => setTimeout(r, 3_000));

  // ── DISCOVERY — memcmp scan on provider field, NO job_id used ────────────
  console.log(`\n--- DISCOVERY PHASE (provider knows only its own pubkey) ---`);
  console.log(`Scanning all JobOffer accounts with provider == ${provider.publicKey.toBase58().slice(0,8)}…`);
  console.log(`Filter: memcmp offset=${PROVIDER_OFFSET}, bytes=${provider.publicKey.toBase58()}`);

  // Count total JobOffer accounts (no filter) for comparison
  const allJobOffers = await consumerClient.program.account.jobOffer.all();
  const filteredJobOffers = await consumerClient.program.account.jobOffer.all([
    {
      memcmp: {
        offset: PROVIDER_OFFSET,
        bytes: provider.publicKey.toBase58(),
      },
    },
  ]);

  console.log(`\nTotal JobOffer accounts on devnet : ${allJobOffers.length}`);
  console.log(`Returned by provider memcmp filter: ${filteredJobOffers.length}`);

  if (filteredJobOffers.length === 0) {
    throw new Error("FAIL: memcmp scan returned 0 accounts — offset or encoding may be wrong");
  }

  // ── Inspect each discovered account ──────────────────────────────────────
  let foundExpected = false;
  let proposedCount = 0;

  for (const raw of filteredJobOffers) {
    const r: any = raw.account;
    const status     = Object.keys(r.status)[0];
    const amount     = (r.amount as BN).toNumber() / 1_000_000;
    const consumer_  = (r.consumer as PublicKey).toBase58();
    const provider_  = (r.provider as PublicKey).toBase58();
    const accDeadline= (r.acceptanceDeadline as BN).toNumber();

    const isExpected = raw.publicKey.equals(expectedPda);
    const isProposed = status === "proposed";

    if (isProposed) proposedCount++;
    if (isExpected) foundExpected = true;

    console.log(`\n  Account: ${raw.publicKey.toBase58()}`);
    console.log(`    status           : ${status}`);
    console.log(`    provider (stored): ${provider_.slice(0,8)}…  matches filter: ${provider_ === provider.publicKey.toBase58()}`);
    console.log(`    consumer         : ${consumer_.slice(0,8)}…`);
    console.log(`    amount           : ${amount} USDC`);
    console.log(`    acceptance_by    : ${new Date(accDeadline * 1000).toISOString()}`);
    console.log(`    is this run's job?: ${isExpected ? "✓ YES" : "no (older job)"}`);
    console.log(`    actionable (Proposed): ${isProposed ? "✓ YES" : "no"}`);
  }

  // ── PDA verification: do we need job_id to verify the address? ───────────
  console.log(`\n--- PDA VERIFICATION ---`);
  console.log(`Known expected PDA (derived with job_id): ${expectedPda.toBase58()}`);
  console.log(`Scan returned that address             : ${foundExpected ? "✓ YES" : "NO — not found"}`);

  // Demonstrate what happens with a WRONG job_id — shows why job_id is still
  // needed to CALL instructions even though discovery is possible without it.
  const wrongJobId = crypto.randomBytes(32);
  const wrongPda = jobOfferPda(consumer.publicKey, wrongJobId);
  console.log(`\nWrong job_id → wrong PDA             : ${wrongPda.toBase58()}`);
  console.log(`(These differ → job_id is still required by program seeds constraint`);
  console.log(` to CALL accept_job/release_escrow; NOT needed for discovery.)`);

  // Confirm all filtered accounts have provider == our pubkey (sanity check)
  const allMatch = filteredJobOffers.every(raw =>
    (raw.account as any).provider.equals(provider.publicKey)
  );
  console.log(`\nAll filtered accounts have provider == me: ${allMatch ? "✓ YES" : "NO — offset wrong"}`);

  // ── Actionable-job filter (client-side) ──────────────────────────────────
  const nowCheck = Math.floor(Date.now() / 1000);
  const actionable = filteredJobOffers.filter(raw => {
    const r: any = raw.account;
    return Object.keys(r.status)[0] === "proposed" &&
           (r.acceptanceDeadline as BN).toNumber() > nowCheck;
  });
  console.log(`\nActionable (Proposed + not expired) : ${actionable.length}`);

  // ── VERDICT ───────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`VERDICT`);
  console.log(`${"═".repeat(60)}`);

  if (foundExpected && allMatch) {
    console.log(`
DISCOVERY: ✓ WORKS — memcmp at offset ${PROVIDER_OFFSET} returns only jobs
  targeted at this provider. The account address is returned directly by
  getProgramAccounts, so the provider learns the JobOffer PDA without
  knowing job_id.

SCALE: memcmp is evaluated server-side (RPC node filters before returning).
  Total accounts on devnet: ${allJobOffers.length}
  Returned by filter: ${filteredJobOffers.length}
  → Filter is O(matched) from the provider's perspective.

ACTION (acceptJob / releaseEscrow / etc.): STILL REQUIRES job_id.
  The Anchor program's seeds constraint on JobOffer is:
    seeds = [b"job", job_offer.consumer, job_id]
  The program re-derives the PDA from consumer (stored in account) + job_id
  (instruction arg) and rejects any mismatch. The provider CANNOT infer
  job_id from the account address alone (PDA is a one-way hash).

CONSEQUENCE — notifyJob/HTTP is REQUIRED for action, OPTIONAL for discovery:
  • The runtime's poll loop already does the discovery correctly (memcmp at
    offset ${PROVIDER_OFFSET}). This part works without notifyJob.
  • To call acceptJob the runtime still needs job_id. notifyJob() (or any
    equivalent out-of-band channel) is therefore required to submit txs.
  • notifyJob is NOT merely a latency optimization — it is load-bearing.

HOW TO ELIMINATE the notifyJob requirement (v2 options):
  A. Store job_id as a field in JobOffer (program change required).
  B. Consumer emits job_id in a transaction log/memo that the provider can
     scan (Layer 4 events or a memo program inscription).
  C. Keep out-of-band delivery (HTTP endpoint on the provider side), which
     is the production x402 flow the agents/researcher already uses.

CONCLUSION: notifyJob stays. The scan is valid for inbox discovery
  (deciding which jobs exist + their amounts/deadlines); action still needs
  the out-of-band hint.
`);
  } else {
    console.log(`DISCOVERY FAILED.`);
    console.log(`foundExpected=${foundExpected}  allMatch=${allMatch}`);
    console.log(`Check offset calculation or encoding.`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error("✗ PROBE FAILED:", e?.message ?? e);
  if (e?.logs) e.logs.forEach((l: string) => console.error(" ", l));
  process.exit(1);
});
