import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { AnchorProvider, Program } from '@anchor-lang/core';
import type { Transaction, VersionedTransaction } from '@solana/web3.js';
import idl from './idl.json';

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? 'FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy',
);

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl('devnet');

// Read-only stub — Program.account.*.all() never calls these
const dummyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
};

export function getConnection(): Connection {
  return new Connection(RPC_ENDPOINT, 'confirmed');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getReadProgram(): Program<any> {
  const provider = new AnchorProvider(getConnection(), dummyWallet, {
    commitment: 'confirmed',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idl as any, provider);
}
