/**
 * web/lib/wallet/minimalWallet.ts — the ONLY wallet-integration code in
 * this codebase. QUARANTINED: this file must only ever be reached via a
 * dynamic `import()` from web/app/agent/[pubkey]/customize (or its client
 * component) — never a static top-level import from anywhere else, or it
 * stops being possible to guarantee the rest of the app (walletless by
 * design) ships zero wallet code to every other visitor.
 *
 * Deliberately hand-rolled against the widely-adopted `window.solana`
 * injected-provider convention (Phantom, Solflare, and Backpack all
 * implement it) instead of pulling in @solana/wallet-adapter-react/-wallets
 * — that family of packages is the "obvious" choice the spec names first,
 * but it's a real npm dependency tree the bundler has to code-split
 * correctly, which is harder to independently verify than "this one
 * small, dependency-free file only loads from one dynamic import site."
 * Tradeoff accepted: no WalletConnect / mobile deep-linking support, only
 * wallets that inject `window.solana` — acceptable for a single low-stakes
 * signed action in an otherwise walletless, read-only dashboard.
 */

export type InjectedSolanaWallet = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
};

export function getInjectedWallet(): InjectedSolanaWallet | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { solana?: InjectedSolanaWallet };
  return w.solana ?? null;
}

export async function connectAndSign(message: string): Promise<{ ownerPubkey: string; signature: Uint8Array }> {
  const wallet = getInjectedWallet();
  if (!wallet) {
    throw new Error("No Solana wallet extension found — install Phantom, Solflare, or Backpack and reload.");
  }
  const { publicKey } = await wallet.connect();
  const encoded = new TextEncoder().encode(message);
  const { signature } = await wallet.signMessage(encoded, "utf8");
  return { ownerPubkey: publicKey.toBase58(), signature };
}
