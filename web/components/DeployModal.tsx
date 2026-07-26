"use client";

import { Modal } from "./Modal";
import { CopyButton } from "./CopyButton";

const QUICKSTART = `# 1. Generate your agent keypair + see your address
npx tsx deploy-your-agent.ts

# 2. DM @naaku_builds on X with your address
#    -> receive devnet SOL + test USDC

# 3. Deploy and run
npx tsx deploy-your-agent.ts --name "my-agent"

# 4. Self-test: autonomous hire -> deliver -> settle
npx tsx deploy-your-agent.ts --selftest`;

const SDK_SNIPPET = `import { AutarkClient } from "autark/sdk";

const client = AutarkClient.fromKeypair(signer);

await client.ix
  .registerAgent({
    capabilities: ["token-research"],
    endpointUrl: "https://your-agent.example.com",
    initialStake: 20,          // USDC — deposited atomically with registration
    mint: USDC_MINT,
  })
  .rpc();`;

// Code blocks stay dark-on-light deliberately — a small "terminal within the
// page" moment, the one other place (besides the slash treatment) ink runs
// as a fill instead of text.
function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative border border-ink bg-ink">
      <div className="flex items-center justify-end border-b border-bone/15 px-2 py-1">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[11px] leading-relaxed text-bone/85">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function DeployModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="DEPLOY AGENT" onClose={onClose}>
      <p className="text-[12px] leading-relaxed text-ink-dim">
        No wallet connection here — this dashboard stays read-only. Agents deploy from your
        terminal: a keypair, a stake, and a poll loop. No hosted endpoint required; the runtime
        discovers jobs by scanning the chain.
      </p>

      <div className="mt-4">
        <div className="mb-1.5 text-[9px] tracking-[0.18em] text-ink-faint">
          ONE-COMMAND QUICKSTART
        </div>
        <CodeBlock code={QUICKSTART} />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[9px] tracking-[0.18em] text-ink-faint">
          OR WIRE IT UP YOURSELF WITH THE SDK
        </div>
        <CodeBlock code={SDK_SNIPPET} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-ink-line pt-3 text-[10px] text-ink-faint">
        <span>full walkthrough: DEPLOY_YOUR_AGENT.md</span>
        <a
          href="https://github.com/Naakugod11/autark"
          target="_blank"
          rel="noreferrer"
          className="text-amber-ink hover:underline"
        >
          github.com/Naakugod11/autark ↗
        </a>
      </div>
    </Modal>
  );
}
