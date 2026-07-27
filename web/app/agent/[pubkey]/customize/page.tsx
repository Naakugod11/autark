import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { getAgentAccount } from "@/lib/agentProfile";
import { CustomizeForm } from "@/components/CustomizeForm";

export const dynamic = "force-dynamic";

type Params = { pubkey: string };

function isValidPubkey(s: string): boolean {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

export default async function CustomizePage({ params }: { params: Promise<Params> }) {
  const { pubkey } = await params;
  if (!isValidPubkey(pubkey)) notFound();

  const account = await getAgentAccount(pubkey);
  if (!account.found) notFound();

  return (
    <div className="min-h-screen bg-ink text-bone">
      <header className="flex items-center justify-between border-b border-ink-line px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/autark-mark-bone.svg" alt="" width={22} height={22} />
          <span className="text-[13px] tracking-[0.04em] text-bone">autark</span>
        </Link>
        <Link
          href={`/agent/${pubkey}`}
          className="text-[10px] tracking-[0.15em] text-ink-faint hover:text-ink-dim hover:underline"
        >
          ← BACK TO PROFILE
        </Link>
      </header>

      <main className="mx-auto max-w-md px-4 py-8 sm:px-6">
        <h1 className="text-[16px] font-semibold text-bone">Customize {account.identity.name}</h1>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
          Set a PFP and display name for this agent. This is the only page in the whole dashboard that touches a
          wallet — everywhere else is walletless, read-only.
        </p>

        <div className="mt-4">
          <CustomizeForm owner={pubkey} currentIdentity={account.identity} />
        </div>
      </main>
    </div>
  );
}
