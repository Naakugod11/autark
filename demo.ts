import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

// ─── Env validation ───────────────────────────────────────────────────────────

const required = [
  "ANTHROPIC_API_KEY",
  "RESEARCHER_PRIVATE_KEY",
  "ANALYZER_PRIVATE_KEY",
  "RUG_SCOUT_PRIVATE_KEY",
  "SENTIMENT_PRIVATE_KEY",
  "USDC_MINT",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`\n  Missing env vars: ${missing.join(", ")}`);
  console.error("  Run: npm run create-mint → npm run fund-agents → npm run demo\n");
  process.exit(1);
}

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

const researcherKp  = Keypair.fromSecretKey(bs58.decode(process.env.RESEARCHER_PRIVATE_KEY!));
const analyzerKp    = Keypair.fromSecretKey(bs58.decode(process.env.ANALYZER_PRIVATE_KEY!));
const rugScoutKp    = Keypair.fromSecretKey(bs58.decode(process.env.RUG_SCOUT_PRIVATE_KEY!));
const sentimentKp   = Keypair.fromSecretKey(bs58.decode(process.env.SENTIMENT_PRIVATE_KEY!));

const ANALYZER_DIR   = path.join(__dirname, "agents/analyzer");
const RUG_SCOUT_DIR  = path.join(__dirname, "agents/rug-scout");
const SENTIMENT_DIR  = path.join(__dirname, "agents/sentiment");
const RESEARCHER_DIR = path.join(__dirname, "agents/researcher");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hr = (label: string) =>
  console.log(`\n${"─".repeat(44)}\n  ${label}\n${"─".repeat(44)}`);

function writeEnv(filePath: string, vars: Record<string, string>) {
  fs.writeFileSync(filePath, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n"));
}

function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () =>
      fetch(url)
        .then((r) => { if (r.ok) resolve(); else retry(); })
        .catch(retry);
    const retry = () => {
      if (Date.now() > deadline) { reject(new Error(`Server timeout: ${url}`)); return; }
      setTimeout(attempt, 1000);
    };
    attempt();
  });
}

async function ensureSol(from: Keypair, toPubkey: import("@solana/web3.js").PublicKey, minLamports: number) {
  const balance = await connection.getBalance(toPubkey);
  if (balance >= minLamports) return;
  const needed = minLamports - balance;
  console.log(`  Funding ${toPubkey.toBase58().slice(0, 8)}... (+${(needed / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey, lamports: needed })
  );
  await sendAndConfirmTransaction(connection, tx, [from]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║        Agent Bazaar  —  Live Demo        ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── 1. Wallets + auto-fund new agents ─────────────────────────────────────
  hr("1 / 5  Wallets");

  const [rSol, aSol, rugSol, sentSol] = await Promise.all([
    connection.getBalance(researcherKp.publicKey),
    connection.getBalance(analyzerKp.publicKey),
    connection.getBalance(rugScoutKp.publicKey),
    connection.getBalance(sentimentKp.publicKey),
  ]);

  console.log(`  Researcher   ${researcherKp.publicKey.toBase58()}  (${(rSol / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
  console.log(`  Analyzer     ${analyzerKp.publicKey.toBase58()}  (${(aSol / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
  console.log(`  Rug Scout    ${rugScoutKp.publicKey.toBase58()}  (${(rugSol / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
  console.log(`  Sentiment    ${sentimentKp.publicKey.toBase58()}  (${(sentSol / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
  console.log(`  USDC mint    ${process.env.USDC_MINT}`);

  if (rSol < 0.05 * LAMPORTS_PER_SOL) {
    console.error("\n  Researcher has < 0.05 SOL — run: npx tsx scripts/transfer-sol.ts\n");
    process.exit(1);
  }

  const MIN_SOL = 0.1 * LAMPORTS_PER_SOL;
  await ensureSol(researcherKp, analyzerKp.publicKey, MIN_SOL);
  await ensureSol(researcherKp, rugScoutKp.publicKey, MIN_SOL);
  await ensureSol(researcherKp, sentimentKp.publicKey, MIN_SOL);

  // ── 2. Write agent .env files ─────────────────────────────────────────────
  hr("2 / 5  Agent config");

  const shared = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    SOLANA_RPC_URL: RPC_URL,
    PROGRAM_ID: "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy",
    USDC_MINT: process.env.USDC_MINT!,
  };

  writeEnv(path.join(ANALYZER_DIR, ".env"), {
    ...shared,
    AGENT_PRIVATE_KEY: process.env.ANALYZER_PRIVATE_KEY!,
    PORT: "3001",
    AGENT_ENDPOINT: "http://localhost:3001",
    AGENT_NAME: "Wallet Analyzer",
  });
  writeEnv(path.join(RUG_SCOUT_DIR, ".env"), {
    ...shared,
    AGENT_PRIVATE_KEY: process.env.RUG_SCOUT_PRIVATE_KEY!,
    PORT: "3002",
    AGENT_ENDPOINT: "http://localhost:3002",
    AGENT_NAME: "Rug Pull Scout",
  });
  writeEnv(path.join(SENTIMENT_DIR, ".env"), {
    ...shared,
    AGENT_PRIVATE_KEY: process.env.SENTIMENT_PRIVATE_KEY!,
    PORT: "3003",
    AGENT_ENDPOINT: "http://localhost:3003",
    AGENT_NAME: "Sentiment Reader",
  });
  writeEnv(path.join(RESEARCHER_DIR, ".env"), {
    ...shared,
    AGENT_PRIVATE_KEY: process.env.RESEARCHER_PRIVATE_KEY!,
    QUESTION:
      `Should I buy WIF? Analyze my wallet: ${researcherKp.publicKey.toBase58()}, check WIF for rug pull risks, AND give me the current market sentiment for WIF.`,
  });

  console.log("  agents/analyzer/.env    ✓");
  console.log("  agents/rug-scout/.env   ✓");
  console.log("  agents/sentiment/.env   ✓");
  console.log("  agents/researcher/.env  ✓");

  // ── 3. Dependencies ───────────────────────────────────────────────────────
  hr("3 / 5  Dependencies");

  const { execSync } = await import("child_process");
  for (const dir of [ANALYZER_DIR, RUG_SCOUT_DIR, SENTIMENT_DIR, RESEARCHER_DIR]) {
    if (!fs.existsSync(path.join(dir, "node_modules"))) {
      console.log(`  Installing ${path.basename(dir)}...`);
      execSync("npm install", { cwd: dir, stdio: "pipe" });
    }
    console.log(`  ${path.basename(dir).padEnd(14)} node_modules ✓`);
  }

  // ── 4. Start provider agents ──────────────────────────────────────────────
  hr("4 / 5  Provider agents (Analyzer · Rug Scout · Sentiment)");

  execSync("lsof -ti:3001,3002,3003 | xargs kill -9 2>/dev/null || true");

  const spawnAgent = (dir: string) =>
    spawn("npx", ["tsx", "src/index.ts"], {
      cwd: dir,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env },
    });

  const analyzer  = spawnAgent(ANALYZER_DIR);
  const rugScout  = spawnAgent(RUG_SCOUT_DIR);
  const sentiment = spawnAgent(SENTIMENT_DIR);
  const providers = [analyzer, rugScout, sentiment];

  let providersAlive = true;
  for (const p of providers) {
    p.on("error", (e) => console.error("  [provider] error:", e.message));
    p.on("exit", (code) => {
      // null = killed by signal (SIGTERM), 143 = SIGTERM on Linux — both expected on shutdown
      if (code !== 0 && code !== 143 && code !== null) console.error(`  [provider] exited unexpectedly (code ${code})`);
    });
  }

  process.on("SIGINT", () => {
    providersAlive = false;
    providers.forEach((p) => p.kill());
    process.exit(1);
  });

  console.log("  Waiting for all agents to be ready...");
  await Promise.all([
    waitForServer("http://localhost:3001/health").then(() => console.log("  Analyzer     :3001 ✓")),
    waitForServer("http://localhost:3002/health").then(() => console.log("  Rug Scout    :3002 ✓")),
    waitForServer("http://localhost:3003/health").then(() => console.log("  Sentiment    :3003 ✓")),
  ]);

  // ── 5. Run Researcher (Claude agent) ─────────────────────────────────────
  hr("5 / 5  Researcher (Claude + multi-agent + parallel jobs)");
  console.log("  Claude discovers agents by capability, hires Wallet Analyzer");
  console.log("  AND Rug Pull Scout in parallel, paying each via on-chain escrow.\n");

  const researcher = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: RESEARCHER_DIR,
    stdio: "inherit",
    env: { ...process.env },
  });

  await new Promise<void>((resolve, reject) => {
    researcher.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Researcher exited ${code}`))));
    researcher.on("error", reject);
  });

  if (providersAlive) providers.forEach((p) => p.kill());

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║              Demo complete!              ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log("  Solana Explorer (devnet):");
  console.log(`    Researcher  https://explorer.solana.com/address/${researcherKp.publicKey.toBase58()}?cluster=devnet`);
  console.log(`    Analyzer    https://explorer.solana.com/address/${analyzerKp.publicKey.toBase58()}?cluster=devnet`);
  console.log(`    Rug Scout   https://explorer.solana.com/address/${rugScoutKp.publicKey.toBase58()}?cluster=devnet`);
  console.log(`    Sentiment   https://explorer.solana.com/address/${sentimentKp.publicKey.toBase58()}?cluster=devnet\n`);
}

main().catch((e) => {
  console.error("\n  Fatal:", e.message ?? e, "\n");
  process.exit(1);
});
