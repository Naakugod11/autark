import "dotenv/config";
import * as crypto from "crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import {
  registerAgent,
  acceptJob,
  releaseEscrow,
  getJob,
} from "../../../sdk/src/index";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3002);
const AGENT_NAME = process.env.AGENT_NAME ?? "Rug Pull Scout";
const AGENT_ENDPOINT = process.env.AGENT_ENDPOINT ?? `http://localhost:${PORT}`;

if (!process.env.AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY is required");
if (!process.env.USDC_MINT) throw new Error("USDC_MINT is required");

const keypair = Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY));
const usdcMint = new PublicKey(process.env.USDC_MINT);
const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  "confirmed"
);

// ─── Rug-pull analysis ────────────────────────────────────────────────────────

// Known devnet-available tokens we can use as demo proxies for mainnet symbols.
const SYMBOL_FALLBACK: Record<string, string | undefined> = {
  // Falls back to our devnet USDC mint so demo always shows real on-chain data.
  WIF: process.env.USDC_MINT,
  BONK: process.env.USDC_MINT,
  SOL: undefined, // SOL is not an SPL token, skip
};

async function analyzeToken(question: string): Promise<string> {
  // Prefer an explicit base58 mint address in the question.
  const addrMatch = question.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/);
  let mintStr = addrMatch?.[0];

  // Fall back to known-symbol mapping for demo tokens.
  if (!mintStr) {
    const symMatch = question.match(/\b(WIF|BONK|SOL)\b/i);
    const sym = symMatch?.[0]?.toUpperCase();
    if (sym) {
      mintStr = SYMBOL_FALLBACK[sym];
      if (!mintStr) return `${sym} is a native token — no SPL mint to audit.`;
    }
  }

  if (!mintStr) {
    mintStr = usdcMint.toBase58(); // ultimate fallback for demo
  }

  let mint: PublicKey;
  try {
    mint = new PublicKey(mintStr);
  } catch {
    return `Invalid mint address: ${mintStr}`;
  }

  const [mintInfo, largestRaw] = await Promise.all([
    connection.getParsedAccountInfo(mint),
    connection.getTokenLargestAccounts(mint).catch(() => null),
  ]);

  if (!mintInfo.value) {
    return `Token ${mintStr.slice(0, 8)}... not found on devnet (mainnet-only token). ` +
      `Using devnet reference token for demo.\n` +
      await analyzeToken(usdcMint.toBase58());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const info = (mintInfo.value.data as any)?.parsed?.info;
  if (!info) return `Could not parse mint data for ${mintStr.slice(0, 8)}...`;

  const mintAuthority: string | null = info.mintAuthority ?? null;
  const freezeAuthority: string | null = info.freezeAuthority ?? null;
  const supply: string = info.supply ?? "0";

  const lines: string[] = [
    `=== Rug Pull Analysis: ${mintStr.slice(0, 8)}... ===`,
    ``,
    `MINT AUTHORITY`,
    mintAuthority
      ? `⚠  Active — ${mintAuthority.slice(0, 8)}... (team can print unlimited tokens)`
      : `✓  Revoked — supply is permanently fixed`,
    ``,
    `FREEZE AUTHORITY`,
    freezeAuthority
      ? `⚠  Active — ${freezeAuthority.slice(0, 8)}... (wallets can be frozen)`
      : `✓  Revoked — no account can be frozen`,
    ``,
    `TOTAL SUPPLY: ${Number(supply).toLocaleString()}`,
  ];

  if (largestRaw?.value?.length) {
    const total = Number(supply);
    lines.push(``, `TOP HOLDERS`);
    let top5Amount = 0;
    largestRaw.value.slice(0, 5).forEach((acct, i) => {
      const pct = total > 0 ? ((Number(acct.amount) / total) * 100).toFixed(1) : "?";
      lines.push(`  ${i + 1}. ${acct.address.toBase58().slice(0, 8)}... — ${pct}%`);
      top5Amount += Number(acct.amount);
    });
    const top5Pct = total > 0 ? (top5Amount / total) * 100 : 0;
    lines.push(`  Top-5 combined: ${top5Pct.toFixed(1)}%`);
    if (top5Pct > 70) lines.push(`⚠  VERY HIGH concentration — rug risk elevated`);
    else if (top5Pct > 40) lines.push(`⚠  Moderate concentration — proceed with caution`);
    else lines.push(`✓  Distribution looks healthy`);
  }

  const risks = [
    mintAuthority ? "active mint authority" : null,
    freezeAuthority ? "active freeze authority" : null,
  ].filter(Boolean);

  lines.push(``);
  if (risks.length === 0) lines.push(`RISK LEVEL: LOW ✓ — No critical rug vectors detected`);
  else if (risks.length === 1) lines.push(`RISK LEVEL: MEDIUM ⚠ — ${risks[0]}`);
  else lines.push(`RISK LEVEL: HIGH 🚨 — ${risks.join(" + ")}`);

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
            maxAmountRequired: "5000", // 0.005 USDC
            resource: `${AGENT_ENDPOINT}/analyze`,
            description: "Rug-pull risk audit — mint/freeze authority + holder concentration",
            mimeType: "application/json",
            payTo: keypair.publicKey.toBase58(),
            maxTimeoutSeconds: 300,
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
  if (jobId.length !== 32)
    return c.json({ error: "X-Payment jobId must be 32 bytes" }, 400);

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

  console.log(`[rug-scout] Accepting job ${jobIdHex.slice(0, 12)}...`);
  try {
    const { signature } = await acceptJob({ signer: keypair, consumer, jobId });
    console.log(`[rug-scout] Accepted: ${signature}`);
  } catch (e: unknown) {
    return c.json({ error: `acceptJob failed: ${(e as Error).message}` }, 500);
  }

  console.log(`[rug-scout] Analyzing token from: "${body.question.slice(0, 60)}..."`);
  const analysis = await analyzeToken(body.question);

  const resultHash = crypto.createHash("sha256").update(analysis).digest();

  console.log("[rug-scout] Releasing escrow...");
  let releaseSig: string;
  try {
    const res = await releaseEscrow({ signer: keypair, consumer, jobId, resultHash, usdcMint });
    releaseSig = res.signature;
    console.log(`[rug-scout] Escrow released: ${releaseSig}`);
  } catch (e: unknown) {
    return c.json({ error: `releaseEscrow failed: ${(e as Error).message}` }, 500);
  }

  return c.json({ analysis, resultHash: resultHash.toString("hex"), releaseTx: releaseSig });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[rug-scout] Starting ${AGENT_NAME}`);
  console.log(`[rug-scout] Wallet: ${keypair.publicKey.toBase58()}`);

  try {
    const { agentPda, signature } = await registerAgent({
      signer: keypair,
      name: AGENT_NAME,
      capability: "rug-detection",
      endpoint: AGENT_ENDPOINT,
      pricePerCall: 0.005,
    });
    console.log(`[rug-scout] Registered: ${agentPda.toBase58()} tx: ${signature}`);
  } catch (e: unknown) {
    const logs: string[] = (e as any)?.logs ?? [];
    if (logs.some((l) => l.includes("already in use") || l.includes("custom program error: 0x0"))) {
      console.log("[rug-scout] Already registered — reusing existing PDA.");
    } else {
      console.warn("[rug-scout] Registration failed:", (e as Error).message);
    }
  }

  serve({ fetch: app.fetch, port: PORT }, () =>
    console.log(`[rug-scout] Listening on http://localhost:${PORT}`)
  );
}

main().catch((e) => { console.error("[rug-scout] Fatal:", e); process.exit(1); });
