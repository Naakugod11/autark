#!/usr/bin/env tsx
/**
 * scripts/setup-demo-agent.ts — one-time provisioning for the web dashboard's
 * "RUN DEMO" button (web/app/api/demo/route.ts).
 *
 * Unlike scripts/demo.ts (which mints fresh throwaway keypairs every run for
 * a clean 0→1 reputation arc), the public demo button reuses ONE fixed
 * provider+consumer pair forever: a public button spammed by many visitors
 * can't afford a fresh registerAgent (extra tx + rent) per click within a
 * ~60s serverless budget, and a recognizable "demo agent" repeatedly getting
 * slashed on the public leaderboard is a better story anyway (visitors can
 * find it and watch its slash count climb over time).
 *
 * Idempotent: re-running skips funding/registration for whichever keypair
 * files already exist under .agent/demo-*.json.
 *
 * Usage: npx tsx scripts/setup-demo-agent.ts
 * Requires: ~/.config/solana/id.json (or WALLET_KEYPAIR_PATH) funded with
 * SOL and holding testMint authority (same deployer used elsewhere in this repo).
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { AutarkClient } from "../sdk/src/client";
import { agentPda } from "../sdk/src/pdas";
import { fetchAgent } from "../sdk/src/types";

const PROVIDER_STAKE_USDC = 40; // covers many 1 USDC job locks before a top-up is needed
const CONSUMER_USDC = 500; // funds hundreds of demo runs (test tokens, free to mint)
const SOL_PER_WALLET = 0.05;

function loadOrCreateKeypair(file: string): { kp: Keypair; isNew: boolean } {
  if (fs.existsSync(file)) {
    return { kp: Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(file, "utf-8")))), isNew: false };
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return { kp, isNew: true };
}

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main() {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../devnet.config.json"), "utf-8")
  );
  const testMint = new PublicKey(config.testMint);
  const deployer = loadKeypair(
    process.env.WALLET_KEYPAIR_PATH ?? path.join(process.env.HOME ?? "~", ".config/solana/id.json")
  );

  const agentDir = path.join(__dirname, "../.agent");
  fs.mkdirSync(agentDir, { recursive: true });
  const providerFile = path.join(agentDir, "demo-provider-keypair.json");
  const consumerFile = path.join(agentDir, "demo-consumer-keypair.json");

  const { kp: providerKp, isNew: providerIsNew } = loadOrCreateKeypair(providerFile);
  const { kp: consumerKp, isNew: consumerIsNew } = loadOrCreateKeypair(consumerFile);

  console.log("demo provider:", providerKp.publicKey.toBase58(), providerIsNew ? "(new)" : "(existing)");
  console.log("demo consumer:", consumerKp.publicKey.toBase58(), consumerIsNew ? "(new)" : "(existing)");

  const deployerClient = AutarkClient.fromKeypair(deployer);
  const conn = deployerClient.connection;

  // ── Fund SOL (idempotent: only top up if below a sane floor) ────────────────
  for (const [label, kp] of [["provider", providerKp], ["consumer", consumerKp]] as const) {
    const bal = await conn.getBalance(kp.publicKey);
    const floor = 0.02 * LAMPORTS_PER_SOL;
    if (bal < floor) {
      const lamports = Math.floor(SOL_PER_WALLET * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: kp.publicKey, lamports })
      );
      const sig = await conn.sendTransaction(tx, [deployer]);
      await conn.confirmTransaction(sig, "confirmed");
      console.log(`funded ${label} with ${SOL_PER_WALLET} SOL`, sig);
    } else {
      console.log(`${label} SOL balance OK (${(bal / LAMPORTS_PER_SOL).toFixed(3)})`);
    }
  }

  // ── Mint test USDC (idempotent: top up if below target) ──────────────────────
  async function ensureUsdc(kp: Keypair, target: number, label: string) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, deployer, testMint, kp.publicKey);
    const bal = (await conn.getTokenAccountBalance(ata.address)).value.uiAmount ?? 0;
    if (bal < target) {
      const topUp = target - bal;
      const sig = await mintTo(conn, deployer, testMint, ata.address, deployer, Math.round(topUp * 1_000_000));
      console.log(`minted ${topUp.toFixed(2)} USDC to ${label}`, sig);
    } else {
      console.log(`${label} USDC balance OK (${bal.toFixed(2)})`);
    }
  }
  await ensureUsdc(providerKp, PROVIDER_STAKE_USDC + 5, "provider");
  await ensureUsdc(consumerKp, CONSUMER_USDC, "consumer");

  // ── Register provider as an Agent (skip if already registered) ──────────────
  const providerClient = AutarkClient.fromKeypair(providerKp);
  const providerAgentAddr = agentPda(providerKp.publicKey);
  const existing = await fetchAgent(providerClient.program, providerAgentAddr).catch(() => null);
  if (existing) {
    console.log(`provider already registered — stake=${(existing.stakeAmount / 1e6).toFixed(2)} USDC, slashEvents=${existing.slashEvents}`);
  } else {
    const sig = await providerClient.ix
      .registerAgent({
        capabilities: ["token-research"],
        endpointUrl: "https://demo.autark.example",
        initialStake: PROVIDER_STAKE_USDC,
        mint: testMint,
      })
      .rpc();
    console.log("registered demo provider agent", sig);
  }

  console.log();
  console.log("Add to web/.env.local (local dev) and Vercel env vars (server-only, no NEXT_PUBLIC prefix):");
  console.log(`DEMO_PROVIDER_KEYPAIR=${JSON.stringify(Array.from(providerKp.secretKey))}`);
  console.log(`DEMO_CONSUMER_KEYPAIR=${JSON.stringify(Array.from(consumerKp.secretKey))}`);
}

main().catch((e) => {
  console.error("setup failed:", e?.message ?? e);
  if (e?.logs) e.logs.forEach((l: string) => console.error("  " + l));
  process.exit(1);
});
