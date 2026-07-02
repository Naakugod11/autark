/**
 * agents/research-agent.ts — on-chain token research agent (Autark).
 *
 * Delivers structured token risk verdicts via the Autark protocol. Uses
 * sdk/src/intelligence/analyze.ts for on-chain signals + LLM verdict.
 *
 * Run standalone:  npx tsx agents/research-agent.ts
 * Import in tests: researchAgent (start/stop), registerJobRequest
 *
 * Env:
 *   ANTHROPIC_API_KEY   — optional; without it the stub path runs (in-character, same format)
 *   SOLANA_RPC_URL      — optional; defaults to public devnet
 *   AGENT_KEYPAIR_PATH  — optional; defaults to .devnet/agent-wallet-1.json
 *
 * Job request convention:
 *   The JobOffer account has no free-text field. Consumers call
 *   registerJobRequest(jobPubkey.toBase58(), target) BEFORE proposeJob().
 *   target = a Solana mint address (base58) or a ticker/name like "WIF".
 *   If no request is registered, the agent analyzes the payment mint as a fallback.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AutarkAgent } from "../sdk/src/runtime";
import { analyze } from "../sdk/src/intelligence/analyze";

// ── Config ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, "..");
const KEYPAIR_PATH =
  process.env.AGENT_KEYPAIR_PATH ??
  path.join(REPO_ROOT, ".devnet/agent-wallet-1.json");
const CONFIG_PATH = path.join(REPO_ROOT, "devnet.config.json");

function loadKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(filePath, "utf-8")))
  );
}

if (!fs.existsSync(CONFIG_PATH)) {
  throw new Error("devnet.config.json not found — run seed-devnet.ts first");
}
const devnetConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const testMint = new PublicKey(devnetConfig.testMint);
const keypair = loadKeypair(KEYPAIR_PATH);

// ANTHROPIC_API_KEY is optional — without it analyze() returns an in-character stub.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.warn(
    "[research-agent] ANTHROPIC_API_KEY not set — running in keyless mode (in-character stub verdicts)"
  );
}

// ── Job request registry ──────────────────────────────────────────────────────
// The JobOffer account has no free-text memo field, so consumers register the
// analysis target here (keyed by jobPubkey.toBase58()) before calling proposeJob.
// The runtime smoke and demo do this automatically. External consumers must call
// registerJobRequest(...) on the same process before the agent's next poll cycle.

const _requestRegistry = new Map<string, string>();

export function registerJobRequest(jobKey: string, target: string): void {
  _requestRegistry.set(jobKey, target);
}

// ── Agent instance ────────────────────────────────────────────────────────────

export const researchAgent = new AutarkAgent({
  keypair,
  capabilities: ["token-research"],
  endpointUrl: "https://agent1.autark.smoke.test",
  mint: testMint,
  minStake: 20.0,
  minPrice: 0,
  pollIntervalMs: 5_000,

  async onJob(job) {
    const jobKey = job.pubkey.toBase58();
    const amountUsdc = (job.amount / 1_000_000).toFixed(2);

    // Look up the registered target; fall back to the payment mint address.
    const target = _requestRegistry.get(jobKey) ?? job.mint.toBase58();
    _requestRegistry.delete(jobKey); // clean up after use

    console.log(
      `[research-agent] onJob — consumer=${job.consumer.toBase58().slice(0, 8)}… ` +
        `amount=${amountUsdc} USDC  target=${target.slice(0, 16)}…`
    );

    try {
      const verdict = await analyze(
        target,
        researchAgent.connection,
        ANTHROPIC_API_KEY
      );

      const mode = ANTHROPIC_API_KEY ? "LLM" : "stub";
      console.log(
        `[research-agent] ✓ Verdict (${mode}, ${verdict.length} chars):\n` +
          verdict
            .split("\n")
            .map((l) => `  ${l}`)
            .join("\n")
      );

      return { deliver: true, result: verdict };
    } catch (e: any) {
      // analyze() already catches LLM errors internally — this catches signal
      // fetch failures or other unexpected throws.
      console.error(`[research-agent] onJob error: ${e?.message ?? e}`);
      return { decline: true };
    }
  },

  async onChallenged(job, challenge) {
    console.log(
      `[research-agent] onChallenged — job=${job.pubkey.toBase58().slice(0, 8)}… ` +
        `challenger=${challenge.challenger.toBase58().slice(0, 8)}… — defending`
    );
    return "defend";
  },
});

// ── Entrypoint (standalone mode) ─────────────────────────────────────────────

if (require.main === module) {
  researchAgent.start().catch((e: any) => {
    console.error("[research-agent] Fatal:", e?.message ?? e);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    researchAgent.stop();
    process.exit(0);
  });
}
