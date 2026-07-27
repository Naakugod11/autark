"use client";

/**
 * web/components/CustomizeForm.tsx — Task 4's upload flow. Wallet code
 * (web/lib/wallet/minimalWallet.ts) is loaded ONLY via the dynamic
 * import() inside handleSubmit below — never a top-level import — so it's
 * only ever fetched by a visitor who actually clicks the sign button on
 * this one page.
 */

import { useRef, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { buildSignedMessage, sha256Hex } from "@/lib/signedUpload";
import type { AgentIdentity } from "@/lib/identity";

type Status = "idle" | "cropping" | "ready" | "signing" | "uploading" | "done" | "error";

const OUTPUT_SIZE = 512;

async function cropToSquarePng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("crop failed"))), "image/png");
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function CustomizeForm({ owner, currentIdentity }: { owner: string; currentIdentity: AgentIdentity }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentIdentity.avatarUrl ?? null);
  const [displayName, setDisplayName] = useState(currentIdentity.generated ? "" : currentIdentity.name);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const croppedBlobRef = useRef<Blob | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setStatus("cropping");
    try {
      const blob = await cropToSquarePng(file);
      croppedBlobRef.current = blob;
      setPreviewUrl(URL.createObjectURL(blob));
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not read that image");
      setStatus("error");
    }
  }

  async function handleSubmit() {
    setError(null);
    try {
      const blob = croppedBlobRef.current;
      if (!blob && !displayName) {
        setError("choose an image and/or enter a display name first");
        return;
      }

      setStatus("signing");
      const bytes = new Uint8Array(await (blob ?? new Blob([])).arrayBuffer());
      const payloadHashHex = await sha256Hex(bytes);
      const timestampMs = Date.now();
      const message = buildSignedMessage({ agentPubkey: owner, timestampMs, displayName, payloadHashHex });

      // Quarantined wallet code — dynamically imported, only from here.
      const { connectAndSign } = await import("@/lib/wallet/minimalWallet");
      const { ownerPubkey, signature } = await connectAndSign(message);

      if (ownerPubkey !== owner) {
        throw new Error(
          `Connected wallet (${ownerPubkey.slice(0, 6)}…) isn't this agent's owner (${owner.slice(0, 6)}…) — connect the wallet that registered this agent.`
        );
      }

      setStatus("uploading");
      const form = new FormData();
      form.set("agentPubkey", owner);
      form.set("timestampMs", String(timestampMs));
      form.set("displayName", displayName);
      form.set("signature", toBase64(signature));
      form.set("file", blob ?? new Blob([]), "pfp.png");

      const res = await fetch("/api/pfp", { method: "POST", body: form });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "upload failed");

      setResultUrl(data.pfpUrl ?? null);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
      setStatus("error");
    }
  }

  const busy = status === "signing" || status === "uploading" || status === "cropping";

  return (
    <div className="flex flex-col gap-4 border border-ink-line bg-ink-raised p-4">
      <div className="flex items-center gap-4">
        <AgentAvatar
          identity={{ ...currentIdentity, avatarUrl: previewUrl ?? undefined }}
          size={64}
        />
        <div>
          <label className="inline-block cursor-pointer border border-ink-line px-3 py-1.5 text-[10px] tracking-[0.12em] text-ink-dim hover:border-bone hover:text-bone">
            CHOOSE IMAGE
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} className="hidden" />
          </label>
          <p className="mt-1 text-[9px] text-ink-faint">PNG/JPEG/WEBP · max 512KB · cropped to square</p>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[9px] tracking-[0.18em] text-ink-faint">DISPLAY NAME (OPTIONAL)</span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.slice(0, 24))}
          maxLength={24}
          placeholder="letters, numbers, spaces, - or _"
          className="border border-ink-line bg-ink px-2 py-1.5 text-[12px] text-bone outline-none focus:border-bone"
        />
      </label>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={busy}
        className={
          "border px-3 py-2 text-[10px] tracking-[0.14em] " +
          (busy ? "cursor-not-allowed border-ink-line text-ink-faint" : "border-bone bg-bone text-ink hover:opacity-80")
        }
      >
        {status === "signing"
          ? "AWAITING WALLET SIGNATURE…"
          : status === "uploading"
            ? "UPLOADING…"
            : status === "cropping"
              ? "PROCESSING IMAGE…"
              : "▸ SIGN & SAVE"}
      </button>

      {status === "done" && (
        <p className="text-[10px] text-green-ink">
          Saved{resultUrl ? " — refresh the profile to see it live." : "."}
        </p>
      )}
      {error && <p className="text-[10px] text-danger-ink">{error}</p>}

      <p className="text-[9px] leading-relaxed text-ink-faint">
        Signing proves you hold the private key for this agent&apos;s registered owner address. Nothing else on
        this dashboard ever asks for a wallet — this is the one signed action in the whole app.
      </p>
    </div>
  );
}
