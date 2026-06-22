import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import * as crypto from "crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

// SDK uses relative imports — no build step needed in the hackathon monorepo.
import {
  registerAgent,
  acceptJob,
  releaseEscrow,
  getJob,
} from "../../../sdk/src/index";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);
const AGENT_NAME = process.env.AGENT_NAME ?? "Wallet Analyzer";
const AGENT_ENDPOINT = process.env.AGENT_ENDPOINT ?? `http://localhost:${PORT}`;

if (!process.env.AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY is required");
if (!process.env.USDC_MINT) throw new Error("USDC_MINT is required");

const keypair = Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY));
const usdcMint = new PublicKey(process.env.USDC_MINT);
const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  "confirmed"
);

// ─── Core analysis logic ──────────────────────────────────────────────────────
// Fetches real on-chain data for a given Solana wallet address.

async function analyzeWallet(walletAddress: string): Promise<string> {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletAddress);
  } catch {
    return `Invalid wallet address: ${walletAddress}`;
  }

  const [solBalance, tokenAccountsResult, signatures] = await Promise.all([
    connection.getBalance(wallet),
    connection.getParsedTokenAccountsByOwner(wallet, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    }),
    connection.getSignaturesForAddress(wallet, { limit: 5 }),
  ]);

  const tokens = tokenAccountsResult.value
    .map((t) => {
      const info = t.account.data.parsed.info;
      return {
        mint: info.mint as string,
        balance: info.tokenAmount.uiAmount as number,
        decimals: info.tokenAmount.decimals as number,
      };
    })
    .filter((t) => t.balance > 0);

  const lines = [
    `=== Wallet Analysis: ${walletAddress} ===`,
    `SOL Balance: ${(solBalance / 1e9).toFixed(4)} SOL`,
    `Token Accounts: ${tokens.length} with non-zero balance`,
  ];

  if (tokens.length > 0) {
    lines.push("Top tokens:");
    tokens.slice(0, 5).forEach((t) => {
      lines.push(`  • ${t.mint.slice(0, 8)}... — ${t.balance} tokens`);
    });
  }

  lines.push(`Recent tx count (last 5): ${signatures.length}`);

  if (solBalance < 0.1 * 1e9) {
    lines.push("⚠ Low SOL balance — risky for active trading.");
  } else {
    lines.push("✓ SOL balance sufficient for normal operations.");
  }

  return lines.join("\n");
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const app = new Hono();

app.get("/health", (c) =>
  c.json({ status: "ok", agent: keypair.publicKey.toBase58(), name: AGENT_NAME })
);

// POST /analyze
// x402 flow:
//   1st call (no X-Payment header) → 402 with payment requirements
//   2nd call (X-Payment: <jobIdHex>:<consumerPubkey>) → verify on-chain → analyze → release → return
// Body: { question: string }
app.post("/analyze", async (c) => {
  // ── x402: advertise requirements if no payment proof provided ──────────────
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
            maxAmountRequired: "10000", // 0.01 USDC (6 decimals)
            resource: `${AGENT_ENDPOINT}/analyze`,
            description: "On-chain wallet analysis — Agent Bazaar",
            mimeType: "application/json",
            payTo: keypair.publicKey.toBase58(),
            maxTimeoutSeconds: 600,
            asset: usdcMint.toBase58(),
            extra: {
              programId:
                process.env.PROGRAM_ID ??
                "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy",
            },
          },
        ],
      },
      402
    );
  }

  // ── Parse X-Payment: "<jobIdHex>:<consumerPubkey>" ────────────────────────
  const colonIdx = paymentHeader.indexOf(":");
  if (colonIdx === -1) {
    return c.json({ error: "Invalid X-Payment: expected <jobIdHex>:<consumerPubkey>" }, 400);
  }
  const jobIdHex = paymentHeader.slice(0, colonIdx);
  const consumerStr = paymentHeader.slice(colonIdx + 1);

  const jobId = Buffer.from(jobIdHex, "hex");
  if (jobId.length !== 32) {
    return c.json({ error: "X-Payment jobId must be 32 bytes (64 hex chars)" }, 400);
  }

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

  const { question } = body;
  if (!question) {
    return c.json({ error: "Missing: question" }, 400);
  }

  // ── 1. Verify job exists and is in Proposed state for this provider ──
  let job;
  try {
    job = await getJob(consumer, jobId);
  } catch (e: unknown) {
    return c.json({ error: `Job not found on-chain: ${(e as Error).message}` }, 404);
  }

  if (job.status !== "proposed") {
    return c.json({ error: `Expected proposed, got: ${job.status}` }, 409);
  }

  if (job.provider.toBase58() !== keypair.publicKey.toBase58()) {
    return c.json(
      {
        error: "Job is not addressed to this analyzer",
        expected: keypair.publicKey.toBase58(),
        got: job.provider.toBase58(),
      },
      403
    );
  }

  console.log(`[analyzer] Accepting job ${jobIdHex.slice(0, 12)}...`);

  // ── 2. Accept the job on-chain (status: Proposed → Accepted) ──
  try {
    const { signature } = await acceptJob({ signer: keypair, consumer, jobId });
    console.log(`[analyzer] Accepted: ${signature}`);
  } catch (e: unknown) {
    return c.json({ error: `acceptJob failed: ${(e as Error).message}` }, 500);
  }

  // ── 3. Extract wallet address from question and analyze ──
  const addressMatch = question.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  if (!addressMatch) {
    console.warn(`[analyzer] No wallet address in question, falling back to consumer: ${consumerStr}`);
  }
  const targetWallet = addressMatch ? addressMatch[0] : consumerStr;

  console.log(`[analyzer] Analyzing wallet: ${targetWallet}`);
  const analysis = await analyzeWallet(targetWallet);

  // ── 4. Hash the result (stored on-chain as proof of delivery) ──
  const resultHash = crypto.createHash("sha256").update(analysis).digest();

  // ── 5. Release escrow → USDC flows to provider ──
  console.log("[analyzer] Releasing escrow...");
  let releaseSig: string;
  try {
    const res = await releaseEscrow({
      signer: keypair,
      consumer,
      jobId,
      resultHash,
      usdcMint,
    });
    releaseSig = res.signature;
    console.log(`[analyzer] Escrow released: ${releaseSig}`);
  } catch (e: unknown) {
    return c.json({ error: `releaseEscrow failed: ${(e as Error).message}` }, 500);
  }

  return c.json({
    analysis,
    resultHash: resultHash.toString("hex"),
    releaseTx: releaseSig,
  });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[analyzer] Starting ${AGENT_NAME}`);
  console.log(`[analyzer] Wallet: ${keypair.publicKey.toBase58()}`);
  console.log(`[analyzer] USDC mint: ${usdcMint.toBase58()}`);
  console.log(`[analyzer] Endpoint: ${AGENT_ENDPOINT}`);

  // Register on-chain. If already registered this tx fails with ConstraintInit —
  // that's fine, the agent is still live from the previous run.
  try {
    const { agentPda, signature } = await registerAgent({
      signer: keypair,
      name: AGENT_NAME,
      capability: "wallet-analysis",
      endpoint: AGENT_ENDPOINT,
      pricePerCall: 0.01, // 0.01 USDC per analysis
    });
    console.log(`[analyzer] Registered on-chain: ${agentPda.toBase58()}`);
    console.log(`[analyzer] Registration tx: ${signature}`);
  } catch (e: unknown) {
    const logs: string[] = (e as any)?.logs ?? [];
    const alreadyExists = logs.some(
      (l) => l.includes("already in use") || l.includes("custom program error: 0x0")
    );
    if (alreadyExists) {
      console.log("[analyzer] Already registered on-chain — reusing existing PDA.");
    } else {
      console.warn("[analyzer] Registration failed:", (e as Error).message);
    }
  }

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[analyzer] Listening on http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  console.error("[analyzer] Fatal:", e);
  process.exit(1);
});
