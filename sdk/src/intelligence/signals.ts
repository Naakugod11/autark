/**
 * sdk/src/intelligence/signals.ts — read-only, in-process on-chain signals.
 *
 * All functions degrade gracefully to "unknown" on RPC failure — they never
 * throw. Signals feed the analyze() LLM call so the verdict is grounded in
 * real chain data when a mint address is provided.
 *
 * No external paid APIs. No keys. Devnet and mainnet both work.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

export type MintSignals = {
  address: string;
  supply: string;          // human-readable, e.g. "1,000,000,000" or "unknown"
  decimals: number | "unknown";
  mintAuthority: "null — fixed supply" | "present — can inflate" | "unknown";
  freezeAuthority: "null" | "present — can freeze wallets" | "unknown";
  topHolderPct: string;    // e.g. "34.2%" or "unknown"
};

export async function getMintSignals(
  conn: Connection,
  mintAddress: string
): Promise<MintSignals> {
  let mintPubkey: PublicKey;
  try {
    mintPubkey = new PublicKey(mintAddress);
  } catch {
    return _unknown(mintAddress);
  }

  let supply = "unknown";
  let decimals: MintSignals["decimals"] = "unknown";
  let mintAuthority: MintSignals["mintAuthority"] = "unknown";
  let freezeAuthority: MintSignals["freezeAuthority"] = "unknown";
  let rawSupply = BigInt(0);
  let gotSupply = false;

  try {
    const mint = await getMint(conn, mintPubkey);
    rawSupply = mint.supply;
    gotSupply = true;
    decimals = mint.decimals;
    const human = Number(rawSupply) / Math.pow(10, mint.decimals);
    supply = human.toLocaleString("en-US", { maximumFractionDigits: 0 });
    mintAuthority =
      mint.mintAuthority === null
        ? "null — fixed supply"
        : "present — can inflate";
    freezeAuthority =
      mint.freezeAuthority === null
        ? "null"
        : "present — can freeze wallets";
  } catch {
    // RPC failure or not a mint — leave as unknown
  }

  let topHolderPct = "unknown";
  try {
    const res = await conn.getTokenLargestAccounts(mintPubkey);
    const accounts = res.value;
    if (accounts.length > 0 && gotSupply && rawSupply > BigInt(0)) {
      const topRaw = BigInt(accounts[0].amount);
      const pct = (Number(topRaw) / Number(rawSupply)) * 100;
      topHolderPct = `${pct.toFixed(1)}%`;
    }
  } catch {
    // ignore
  }

  return { address: mintAddress, supply, decimals, mintAuthority, freezeAuthority, topHolderPct };
}

function _unknown(address: string): MintSignals {
  return {
    address,
    supply: "unknown",
    decimals: "unknown",
    mintAuthority: "unknown",
    freezeAuthority: "unknown",
    topHolderPct: "unknown",
  };
}
