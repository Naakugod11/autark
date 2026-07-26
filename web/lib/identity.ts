/**
 * web/lib/identity.ts — off-chain display identity for on-chain agents.
 *
 * Agent names and avatars are NOT on-chain (only owner pubkey, capabilities,
 * endpointUrl, scores, stake). This maps a small set of known pubkeys to
 * readable names; anything unmapped — including fresh keypairs the demo
 * script spins up every run — gets a deterministic generated name so every
 * pubkey always renders as a presentable agent.
 */

// owner pubkey (base58) -> display name. Extend as real agents are deployed.
const KNOWN_AGENTS: Record<string, string> = {
  // The RUN DEMO button's fixed provider (scripts/setup-demo-agent.ts) —
  // named so visitors can find it and watch its slash count climb.
  "5724MfZvQj4G3bzoPVs2ggjvCQqdNenaDU3AZPw5Zgiy": "demo-agent",
};

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
