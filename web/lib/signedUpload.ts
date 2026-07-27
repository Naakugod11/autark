/**
 * web/lib/signedUpload.ts — the ONE signed action in this otherwise
 * walletless dashboard (Task 4: PFP/display-name upload). This module
 * defines the exact message format and verification logic, shared by:
 *   - the customize page's browser wallet signing (web/app/agent/[pubkey]/customize)
 *   - the server route that verifies it (web/app/api/pfp/route.ts)
 *   - the e2e proof script that signs with the demo keypair (scripts/sign-demo-pfp-upload.ts)
 * Defining the message format once and importing it everywhere means the
 * three can never silently drift out of sync with each other.
 *
 * Works unmodified in the browser AND in Node (script + server route):
 * TextEncoder and globalThis.crypto.subtle are both standard, no
 * browser-only or Node-only API used here.
 */

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

export const PFP_UPLOAD_DOMAIN = "autark-pfp-upload:v1";
export const SIGNATURE_FRESHNESS_MS = 5 * 60 * 1000;

export type PfpUploadPayload = {
  /** Base58 owner pubkey — the Agent account's on-chain authority (Agent.owner). */
  agentPubkey: string;
  /** Timestamp nonce, ms epoch — freshness enforced server-side (±5 min). */
  timestampMs: number;
  /** "" when no display name is being set — always included so the signature commits to it either way. */
  displayName: string;
  /** sha256 hex digest of the exact image bytes being uploaded. */
  payloadHashHex: string;
};

// A single canonical string, not JSON — avoids any ambiguity from key
// ordering/whitespace differences between a JSON.stringify on one side and
// a hand-built object on the other; every field is unambiguously delimited
// and the whole thing is exactly what gets signed.
export function buildSignedMessage(p: PfpUploadPayload): string {
  return `${PFP_UPLOAD_DOMAIN}:${p.agentPubkey}:${p.timestampMs}:${p.displayName}:${p.payloadHashHex}`;
}

export function isFresh(timestampMs: number, now: number = Date.now()): boolean {
  return Math.abs(now - timestampMs) <= SIGNATURE_FRESHNESS_MS;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Verifies the signature against the CLAIMED owner pubkey only — callers
// (the API route) are responsible for separately confirming that pubkey is
// actually this agent's on-chain authority (Agent.owner) before trusting
// the request; this function only proves "the holder of this pubkey's
// private key signed exactly this payload," not "this pubkey owns this
// agent."
export function verifySignedMessage(message: string, signature: Uint8Array, ownerBase58: string): boolean {
  try {
    const pubkeyBytes = new PublicKey(ownerBase58).toBytes();
    const messageBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(messageBytes, signature, pubkeyBytes);
  } catch {
    return false;
  }
}
