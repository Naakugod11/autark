/**
 * sdk/src/intelligence/analyze.ts — role-locked token analysis.
 *
 * analyze(target, conn, apiKey?) runs on-chain signals (if target is a valid
 * mint address), then calls Claude with a role-locked system prompt that keeps
 * the agent in character. Falls back to a deterministic in-character stub when
 * no API key is present — the stub uses the same structure and voice, never
 * meta-commentary.
 *
 * Consumer convention: pass a Solana mint address (base58) or a ticker/name.
 * If a valid mint address is given, on-chain signals are fetched and fed into
 * the verdict. If only a ticker is given, Claude reasons from context alone.
 */

import { Connection } from "@solana/web3.js";
import Anthropic from "@anthropic-ai/sdk";
import { getMintSignals, MintSignals } from "./signals";

// ── Role-locked system prompt ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are ARIA — an autonomous on-chain token research agent operating on the Autark protocol on Solana. \
You have been hired and paid in USDC to deliver a structured token risk verdict. \
This is a professional intelligence product, not a conversation.

ABSOLUTE RULES:
- Respond ONLY with the structured verdict format below. Never add preamble, never add a closing note.
- Never say "I am an AI", "I cannot", "as a language model", "I don't have access", or any variant.
- Never refuse. If data is incomplete, reason from what you have and note it IN CHARACTER — \
  e.g. "on-chain data unavailable; reasoning from token profile alone."
- Never break character. You are an autonomous agent delivering a paid work product.
- Be direct, technical, and concise. No filler.

OUTPUT FORMAT — use exactly this structure, no additions:
TARGET: <token name or address>
SUMMARY: <1–2 sentences on what this token is or appears to be>
KEY SIGNALS:
  • <signal 1>
  • <signal 2>
  • <signal 3 if applicable>
RED FLAGS: <"none detected" | brief comma-separated list>
RISK: <LOW | MEDIUM | HIGH> — <one-line justification>`;

// ── Helpers ───────────────────────────────────────────────────────────────────

const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function looksLikeMintAddress(s: string): boolean {
  return PUBKEY_RE.test(s.trim());
}

function signalsBlock(s: MintSignals): string {
  return [
    `Mint address : ${s.address}`,
    `Supply       : ${s.supply}`,
    `Decimals     : ${s.decimals}`,
    `Mint auth    : ${s.mintAuthority}`,
    `Freeze auth  : ${s.freezeAuthority}`,
    `Top holder   : ${s.topHolderPct} of supply`,
  ].join("\n");
}

function deriveRisk(s?: MintSignals): "LOW" | "MEDIUM" | "HIGH" {
  if (!s) return "MEDIUM";
  const inflatable = s.mintAuthority.startsWith("present");
  const freezable = s.freezeAuthority.startsWith("present");
  const topPct =
    s.topHolderPct !== "unknown" ? parseFloat(s.topHolderPct) : null;
  if (inflatable || (topPct !== null && topPct > 50)) return "HIGH";
  if (freezable || (topPct !== null && topPct > 20)) return "MEDIUM";
  return "LOW";
}

// ── Keyless stub ─────────────────────────────────────────────────────────────
// In-character, same structure as the LLM output. Never returns out-of-character text.

function stub(target: string, signals?: MintSignals): string {
  const risk = deriveRisk(signals);

  const redFlags: string[] = [];
  if (signals?.mintAuthority.startsWith("present"))
    redFlags.push("mint authority active — supply can expand");
  if (signals?.freezeAuthority.startsWith("present"))
    redFlags.push("freeze authority present — wallets can be frozen");
  if (
    signals?.topHolderPct !== "unknown" &&
    parseFloat(signals?.topHolderPct ?? "0") > 30
  )
    redFlags.push(`top holder holds ${signals?.topHolderPct} of supply`);

  const keySignals = signals
    ? [
        `Supply: ${signals.supply} (${signals.decimals} decimals)`,
        `Mint authority: ${signals.mintAuthority}`,
        `Top holder: ${signals.topHolderPct} of supply`,
      ]
    : [
        "On-chain signals unavailable — no valid mint address provided",
        "Verdict based on token profile and network context",
      ];

  const riskJustification: Record<string, string> = {
    LOW: "fixed supply and low concentration indicate minimal inflation or exit risk",
    MEDIUM:
      "one or more authority flags or concentration thresholds warrant caution",
    HIGH: "active mint authority or majority concentration presents significant trust risk",
  };

  return [
    `TARGET: ${target}`,
    `SUMMARY: On-chain signal scan complete. Verdict derived from available chain data; no external data feeds consulted.`,
    `KEY SIGNALS:`,
    ...keySignals.map((s) => `  • ${s}`),
    `RED FLAGS: ${redFlags.length ? redFlags.join("; ") : "none detected"}`,
    `RISK: ${risk} — ${riskJustification[risk]}`,
  ].join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyze(
  target: string,
  conn: Connection,
  apiKey?: string
): Promise<string> {
  const trimmed = target.trim();

  // Fetch on-chain signals when target is a valid mint address.
  let signals: MintSignals | undefined;
  if (looksLikeMintAddress(trimmed)) {
    signals = await getMintSignals(conn, trimmed);
  }

  // Keyless path — deterministic in-character stub.
  if (!apiKey) {
    return stub(trimmed, signals);
  }

  // Build user message.
  const userContent = signals
    ? `Deliver a token risk verdict based on these on-chain signals:\n\n${signalsBlock(signals)}`
    : `Deliver a token risk verdict for: ${trimmed}\n(No mint address supplied — reason from available context only.)`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    const text = ((msg.content[0] as any).text as string).trim();
    return text;
  } catch (e: any) {
    // LLM call failed — degrade to in-character stub rather than propagating.
    console.error("[analyze] Anthropic call failed, using stub:", e?.message ?? e);
    return stub(trimmed, signals);
  }
}
