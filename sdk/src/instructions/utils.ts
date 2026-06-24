import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";

export const USDC_FACTOR = 1_000_000; // 6 decimals
export const DEFAULT_CU_PRICE = 50_000; // microLamports

export type IxRpcOptions = {
  computeUnitPrice?: number;
};

export type IxBuilder = {
  instruction(): Promise<TransactionInstruction>;
  rpc(opts?: IxRpcOptions): Promise<string>;
};

// Convert a USDC float to on-chain base units (BN).
export function toUSDC(amount: number): BN {
  if (amount <= 0) throw new Error(`amount must be > 0, got ${amount}`);
  return new BN(Math.round(amount * USDC_FACTOR));
}

// Convert a Uint8Array / number[] to the number[] Anchor expects for [u8;32].
export function toId(id: Uint8Array | number[]): number[] {
  return Array.from(id);
}

// Wrap an Anchor MethodsBuilder factory so callers get .instruction() and .rpc()
// without being forced to manage builder mutations.  Each call to mk() is a fresh
// builder so priority-fee pre-instructions don't accumulate across invocations.
export function makeIx(mk: () => any): IxBuilder {
  return {
    instruction: () => mk().instruction(),
    rpc: ({ computeUnitPrice = DEFAULT_CU_PRICE }: IxRpcOptions = {}) =>
      mk()
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: computeUnitPrice,
          }),
        ])
        .rpc(),
  };
}
