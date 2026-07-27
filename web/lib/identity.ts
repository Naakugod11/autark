/**
 * web/lib/identity.ts — off-chain display identity for on-chain agents.
 *
 * Agent names and avatars are NOT on-chain (only owner pubkey, capabilities,
 * endpointUrl, scores, stake). This maps a small set of known pubkeys to
 * readable names; anything unmapped — including fresh keypairs the demo
 * script spins up every run — gets a deterministic generated name so every
 * pubkey always renders as a presentable agent.
 *
 * Precedence (Task 4 added the first tier): signed upload > static config
 * (KNOWN_AGENTS name / PFP_BLOCKLIST) > deterministic fallback. identityFor()
 * itself only ever computes the bottom two tiers and stays synchronous — it
 * is called from hot, sync client paths (web/lib/economy.ts's event
 * handlers) that can't await a fetch. The upload tier is layered on top by
 * resolveIdentity(), given an already-fetched overrides manifest (see
 * web/lib/identityOverrides.ts) — callers that don't have one yet (or don't
 * care about uploads) just keep calling identityFor() directly, unchanged.
 */

// owner pubkey (base58) -> display name. Extend as real agents are deployed.
const KNOWN_AGENTS: Record<string, string> = {
  // The RUN DEMO button's fixed provider (scripts/setup-demo-agent.ts) —
  // named so visitors can find it and watch its slash count climb.
  "5724MfZvQj4G3bzoPVs2ggjvCQqdNenaDU3AZPw5Zgiy": "demo-agent",
};

// The minimal moderation lever the spec asks for: a blocklisted owner's
// uploaded PFP/name is NEVER shown, no matter what's in the upload
// manifest — this beats the upload tier, full stop, and is checked inside
// resolveIdentity() before an override is ever applied.
const PFP_BLOCKLIST: ReadonlySet<string> = new Set([]);

export function isBlocklisted(owner: string): boolean {
  return PFP_BLOCKLIST.has(owner);
}

const NAME_WORDS = [
  "sentinel", "cipher", "vector", "quanta", "signal", "oracle", "raster",
  "lumen", "flux", "nomad", "helix", "prism", "ember", "vertex", "shard",
  "relay", "drift", "onyx", "pylon", "warden", "scout", "forge", "cursor",
] as const;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type AgentIdentity = {
  name: string;
  short: string;
  generated: boolean;
  hue: number;
  glyph: string;
  /** Set only when a signed PFP upload applies (Task 4) — undefined means "render the generated glyph tile." */
  avatarUrl?: string;
};

export function identityFor(ownerBase58: string): AgentIdentity {
  const known = KNOWN_AGENTS[ownerBase58];
  const h = hashString(ownerBase58);
  const short = ownerBase58.slice(0, 4);
  const name = known ?? `${NAME_WORDS[h % NAME_WORDS.length]}-${short.toLowerCase()}`;

  // Restrict generated tile hue to the amber family (28–46) so unmapped
  // agents stay visually on-brand instead of reading as arbitrary color noise.
  const hue = 28 + (h % 19);

  return {
    name,
    short,
    generated: !known,
    hue,
    glyph: ownerBase58.slice(0, 2).toUpperCase(),
  };
}

// ── Upload overrides (Task 4) ────────────────────────────────────────────────

export type IdentityOverride = { pfpUrl?: string; displayName?: string };
export type IdentityOverridesManifest = Record<string, IdentityOverride>;

// Layers a fetched upload-overrides manifest (web/lib/identityOverrides.ts)
// on top of identityFor()'s sync base — this is the one place the full
// upload > static config > fallback precedence actually gets composed.
// Blocklisted owners fall through to the plain identityFor() result as if
// no override existed, no matter what the manifest says.
export function resolveIdentity(ownerBase58: string, overrides: IdentityOverridesManifest | null | undefined): AgentIdentity {
  const base = identityFor(ownerBase58);
  if (isBlocklisted(ownerBase58)) return base;

  const override = overrides?.[ownerBase58];
  if (!override) return base;

  return {
    ...base,
    name: override.displayName || base.name,
    generated: override.displayName ? false : base.generated,
    avatarUrl: override.pfpUrl || base.avatarUrl,
  };
}
