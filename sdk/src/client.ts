import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import type { Autark } from "../../target/types/autark";

const idl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../target/idl/autark.json"),
    "utf-8"
  )
);

export function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
}

// Anchor 1.0 strict .accounts() union type workaround — cast through any.
// The runtime is correct; TS just can't resolve the discriminated union for
// multi-key account objects.
export const accs = (obj: Record<string, unknown>) => obj as any;

export class AutarkClient {
  readonly program: Program<Autark>;
  readonly connection: Connection;

  private constructor(program: Program<Autark>, connection: Connection) {
    this.program = program;
    this.connection = connection;
  }

  // Node/script path: keypair-backed signer.
  static fromKeypair(signer: Keypair, rpcUrl?: string): AutarkClient {
    const url = rpcUrl ?? getRpcUrl();
    const connection = new Connection(url, "confirmed");
    const wallet = new Wallet(signer);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const program = new Program<Autark>(idl, provider);
    return new AutarkClient(program, connection);
  }

  // Read-only path: no real signer needed (fetches only).
  static readOnly(rpcUrl?: string): AutarkClient {
    const url = rpcUrl ?? getRpcUrl();
    const connection = new Connection(url, "confirmed");
    const wallet = new Wallet(Keypair.generate());
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const program = new Program<Autark>(idl, provider);
    return new AutarkClient(program, connection);
  }

  // Wallet-adapter path (frontend) — to be wired once @solana/wallet-adapter
  // is added to the root dep tree. Signature:
  //   static fromWallet(wallet: AnchorWallet, rpcUrl?: string): AutarkClient
  // AnchorWallet = { publicKey, signTransaction, signAllTransactions }
}
