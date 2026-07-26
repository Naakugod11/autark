const IS_MISSING_ENV = (msg: string) => msg.includes("NEXT_PUBLIC_SOLANA_RPC_URL is not set");

export function ConnectionError({ message }: { message: string | null }) {
  const msg = message ?? "connection failed";
  const missingEnv = IS_MISSING_ENV(msg);

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md border border-danger bg-danger-wash">
        <div className="border-b border-danger px-4 py-2">
          <h2 className="text-[11px] font-semibold tracking-[0.22em] text-danger-ink">
            {missingEnv ? "RPC NOT CONFIGURED" : "CAN'T REACH SOLANA DEVNET"}
          </h2>
        </div>
        <div className="p-4">
          <p className="text-[12px] leading-relaxed text-ink-dim">{msg}</p>
          <ul className="mt-3 space-y-1 text-[10px] leading-relaxed text-ink-faint">
            {missingEnv ? (
              <>
                <li>· Set NEXT_PUBLIC_SOLANA_RPC_URL in this environment's variables.</li>
                <li>· See web/.env.example for a working devnet RPC URL format.</li>
              </>
            ) : (
              <>
                <li>· The RPC URL may be unreachable, invalid, or rate-limiting this key.</li>
                <li>· Check NEXT_PUBLIC_SOLANA_RPC_URL points at a live Solana devnet endpoint.</li>
              </>
            )}
            <li>· This page will keep retrying on its own — no action needed once fixed.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
