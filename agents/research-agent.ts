/**
 * agents/research-agent.ts — Claude-backed Autark agent (token-research capability).
 *
 * Uses the AutarkAgent runtime. onJob makes a single Anthropic call and returns
 * a brief token/wallet analysis. This proves the end-to-end runtime loop without
 * implementing a full 0xpilot-style research pipeline — that is a later layer.
 *
 * Run standalone:  npx tsx agents/research-agent.ts
 * Or import researchAgent and call start()/stop() from a test script.
 *
 * Requires env:  ANTHROPIC_API_KEY
 * Keypair:       .devnet/agent-wallet-1.json (or AGENT_KEYPAIR_PATH)
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AutarkAgent } from "../sdk/src/runtime";

// ── Config ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, "..");
const KEYPAIR_PATH =
  process.env.AGENT_KEYPAIR_PATH ??
  path.join(REPO_ROOT, ".devnet/agent-wallet-1.json");
const CONFIG_PATH = path.join(REPO_ROOT, "devnet.config.json");

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Buffer.from(raw));
}

if (!fs.existsSync(CONFIG_PATH)) {
  throw new Error("devnet.config.json not found — run seed-devnet.ts first");
}
const devnetConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const testMint = new PublicKey(devnetConfig.testMint);
const keypair = loadKeypair(KEYPAIR_PATH);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY env var is required");
}
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── Agent instance ────────────────────────────────────────────────────────────

export const researchAgent = new AutarkAgent({
  keypair,
  capabilities: ["token-research"],
  endpointUrl: "https://agent1.autark.smoke.test", // placeholder; HTTP server is a later layer
  mint: testMint,
  minStake: 20.0,
  minPrice: 0,
  pollIntervalMs: 5_000,

  async onJob(job) {
    const consumerShort = job.consumer.toBase58().slice(0, 8);
    const amountUsdc = (job.amount / 1_000_000).toFixed(2);
    console.log(
      `[research-agent] onJob — consumer=${consumerShort}… amount=${amountUsdc} USDC`
    );

    try {
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 128,
        messages: [
          {
            role: "user",
            content:
              `You are an automated Solana token research agent fulfilling a paid on-chain job. ` +
              `Job amount: ${amountUsdc} USDC. Consumer wallet: ${job.consumer.toBase58()}. ` +
              `Provide exactly two sentences of generic Solana DeFi market commentary ` +
              `acknowledging this request.`,
          },
        ],
      });

      const text = (msg.content[0] as any).text as string;
      console.log(
        `[research-agent] Analysis (${text.length} chars): ${text.slice(0, 80)}…`
      );
      return { deliver: true, result: text };
    } catch (e: any) {
      console.error(`[research-agent] Anthropic error: ${e?.message ?? e}`);
      // Decline so the consumer gets their USDC back rather than hanging.
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
