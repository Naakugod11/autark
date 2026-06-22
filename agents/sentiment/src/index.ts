import "dotenv/config";
import * as crypto from "crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import {
  registerAgent,
  acceptJob,
  releaseEscrow,
  getJob,
} from "../../../sdk/src/index";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3003);
const AGENT_NAME = process.env.AGENT_NAME ?? "Sentiment Reader";
const AGENT_ENDPOINT = process.env.AGENT_ENDPOINT ?? `http://localhost:${PORT}`;

if (!process.env.AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY is required");
if (!process.env.USDC_MINT) throw new Error("USDC_MINT is required");

const keypair = Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY));
const usdcMint = new PublicKey(process.env.USDC_MINT);

// ─── Sentiment analysis (simulated) ──────────────────────────────────────────

type SentimentData = {
  score: number;
  trend: string;
  mentions_24h: number;
  top_signals: string[];
};

const MOCK_SENTIMENT: Record<string, SentimentData> = {
  WIF: {
    score: 0.62,
    trend: "neutral-bullish",
    mentions_24h: 14_200,
    top_signals: [
      "whale accumulation detected in last 6h",
      "mention frequency up 34% vs 7d avg",
      "memecoin season index rising",
      "3 influencer posts with >50k reach",
    ],
  },
  BONK: {
    score: 0.71,
    trend: "bullish",
    mentions_24h: 32_000,
    top_signals: [
      "strong meme community engagement",
      "new CEX listing speculation trending",
      "positive on-chain transfer volume spike",
    ],
  },
  SOL: {
    score: 0.78,
    trend: "bullish",
    mentions_24h: 89_000,
    top_signals: [
      "institutional interest growing",
      "ecosystem TVL up 12% this week",
      "developer activity at 6-month high",
    ],
  },
  JUP: {
    score: 0.55,
    trend: "neutral",
    mentions_24h: 8_400,
    top_signals: [
      "steady community engagement",
      "upcoming token unlock concerns in discussion",
    ],
  },
};

function analyzeSentiment(question: string): string {
  const symMatch = question.match(/\b(WIF|BONK|SOL|JUP|BTC|ETH)\b/i);
  const symbol = symMatch?.[0]?.toUpperCase() ?? "TOKEN";

  const data: SentimentData = MOCK_SENTIMENT[symbol] ?? {
    score: 0.45,
    trend: "neutral",
    mentions_24h: 1_200,
    top_signals: ["limited data available", "low social volume detected"],
  };

  const scoreBar = "█".repeat(Math.round(data.score * 10)) + "░".repeat(10 - Math.round(data.score * 10));

  const lines = [
    `=== Sentiment Analysis: ${symbol} [SIMULATED] ===`,
    ``,
    `Score:    ${data.score.toFixed(2)} / 1.00  [${scoreBar}]`,
    `Trend:    ${data.trend.toUpperCase()}`,
    `Mentions: ${data.mentions_24h.toLocaleString()} / 24h`,
    ``,
    `Top Signals:`,
    ...data.top_signals.map((s) => `  • ${s}`),
    ``,
    `[Note: Simulated social data — for demonstration purposes only]`,
  ];

  return lines.join("\n");
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const app = new Hono();

app.get("/health", (c) =>
  c.json({ status: "ok", agent: keypair.publicKey.toBase58(), name: AGENT_NAME })
);

app.post("/analyze", async (c) => {
  const paymentHeader = c.req.header("X-Payment");

  if (!paymentHeader) {
    return c.json(
      {
        x402Version: 1,
        error: "Payment required",
        accepts: [
          {
            scheme: "exact",
            network: "solana-devnet",
            maxAmountRequired: "8000", // 0.008 USDC
            resource: `${AGENT_ENDPOINT}/analyze`,
            description: "Social sentiment aggregation for Solana tokens",
            mimeType: "application/json",
            payTo: keypair.publicKey.toBase58(),
            maxTimeoutSeconds: 120,
            asset: usdcMint.toBase58(),
            extra: {
              programId:
                process.env.PROGRAM_ID ?? "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy",
            },
          },
        ],
      },
      402
    );
  }

  const colonIdx = paymentHeader.indexOf(":");
  if (colonIdx === -1)
    return c.json({ error: "Invalid X-Payment: expected <jobIdHex>:<consumerPubkey>" }, 400);

  const jobIdHex = paymentHeader.slice(0, colonIdx);
  const consumerStr = paymentHeader.slice(colonIdx + 1);
  const jobId = Buffer.from(jobIdHex, "hex");
  if (jobId.length !== 32) return c.json({ error: "X-Payment jobId must be 32 bytes" }, 400);

  let consumer: PublicKey;
  try {
    consumer = new PublicKey(consumerStr);
  } catch {
    return c.json({ error: "Invalid consumer pubkey in X-Payment" }, 400);
  }

  let body: { question: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.question) return c.json({ error: "Missing: question" }, 400);

  let job;
  try {
    job = await getJob(consumer, jobId);
  } catch (e: unknown) {
    return c.json({ error: `Job not found: ${(e as Error).message}` }, 404);
  }

  if (job.status !== "proposed")
    return c.json({ error: `Expected proposed, got: ${job.status}` }, 409);

  if (job.provider.toBase58() !== keypair.publicKey.toBase58())
    return c.json({ error: "Job not addressed to this agent" }, 403);

  console.log(`[sentiment] Accepting job ${jobIdHex.slice(0, 12)}...`);
  try {
    const { signature } = await acceptJob({ signer: keypair, consumer, jobId });
    console.log(`[sentiment] Accepted: ${signature}`);
  } catch (e: unknown) {
    return c.json({ error: `acceptJob failed: ${(e as Error).message}` }, 500);
  }

  const analysis = analyzeSentiment(body.question);
  const resultHash = crypto.createHash("sha256").update(analysis).digest();

  console.log("[sentiment] Releasing escrow...");
  let releaseSig: string;
  try {
    const res = await releaseEscrow({ signer: keypair, consumer, jobId, resultHash, usdcMint });
    releaseSig = res.signature;
    console.log(`[sentiment] Escrow released: ${releaseSig}`);
  } catch (e: unknown) {
    return c.json({ error: `releaseEscrow failed: ${(e as Error).message}` }, 500);
  }

  return c.json({ analysis, resultHash: resultHash.toString("hex"), releaseTx: releaseSig });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[sentiment] Starting ${AGENT_NAME}`);
  console.log(`[sentiment] Wallet: ${keypair.publicKey.toBase58()}`);

  try {
    const { agentPda, signature } = await registerAgent({
      signer: keypair,
      name: AGENT_NAME,
      capability: "sentiment-analysis",
      endpoint: AGENT_ENDPOINT,
      pricePerCall: 0.008,
    });
    console.log(`[sentiment] Registered: ${agentPda.toBase58()} tx: ${signature}`);
  } catch (e: unknown) {
    const logs: string[] = (e as any)?.logs ?? [];
    if (logs.some((l) => l.includes("already in use") || l.includes("custom program error: 0x0"))) {
      console.log("[sentiment] Already registered — reusing existing PDA.");
    } else {
      console.warn("[sentiment] Registration failed:", (e as Error).message);
    }
  }

  serve({ fetch: app.fetch, port: PORT }, () =>
    console.log(`[sentiment] Listening on http://localhost:${PORT}`)
  );
}

main().catch((e) => { console.error("[sentiment] Fatal:", e); process.exit(1); });
