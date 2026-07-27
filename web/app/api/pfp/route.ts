/**
 * web/app/api/pfp/route.ts — Task 4's one signed write path in an
 * otherwise walletless, read-only dashboard.
 *
 * Ownership proof: the request must be signed by the exact keypair that is
 * this Agent's on-chain authority (Agent.owner — see the IDL; profiles in
 * this app are already addressed by owner, so "the agent pubkey" and "the
 * signer" are the same pubkey by construction). Verification order matters:
 * freshness and signature validity are checked BEFORE anything touches
 * storage, and the on-chain owner lookup happens before the signature
 * check is trusted for authorization (a valid signature from a pubkey that
 * isn't this agent's owner must still be rejected).
 *
 * multipart/form-data fields: file, agentPubkey, timestampMs, displayName
 * (may be empty string), signature (base64, 64-byte ed25519 detached sig).
 */

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getAgentsSnapshot } from "@/lib/chainCache";
import { buildSignedMessage, isFresh, sha256Hex, verifySignedMessage } from "@/lib/signedUpload";
import { processPfpUpload, isValidDisplayName, sanitizeDisplayName } from "@/lib/pfpValidation";
import { getPfpStore } from "@/lib/pfpStore";
import { isBlocklisted } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidPubkey(s: string): boolean {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }

  const agentPubkey = String(form.get("agentPubkey") ?? "");
  const timestampMsRaw = String(form.get("timestampMs") ?? "");
  const displayNameRaw = String(form.get("displayName") ?? "");
  const signatureB64 = String(form.get("signature") ?? "");
  const file = form.get("file");

  if (!isValidPubkey(agentPubkey)) {
    return NextResponse.json({ ok: false, error: "invalid agentPubkey" }, { status: 400 });
  }
  if (isBlocklisted(agentPubkey)) {
    return NextResponse.json({ ok: false, error: "this pubkey is not permitted to customize its profile" }, { status: 403 });
  }

  const timestampMs = Number(timestampMsRaw);
  if (!Number.isFinite(timestampMs)) {
    return NextResponse.json({ ok: false, error: "invalid timestampMs" }, { status: 400 });
  }
  if (!isFresh(timestampMs)) {
    return NextResponse.json({ ok: false, error: "signature has expired — sign and submit again" }, { status: 400 });
  }

  const displayName = sanitizeDisplayName(displayNameRaw);
  if (displayName.length > 0 && !isValidDisplayName(displayName)) {
    return NextResponse.json(
      { ok: false, error: "display name must be 1-24 characters: letters, numbers, spaces, - or _" },
      { status: 400 }
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });
  }
  const rawBytes = Buffer.from(await file.arrayBuffer());

  // The signature commits to a hash of the EXACT bytes uploaded — signing
  // "some PFP" and then swapping the file after the fact must not be
  // possible.
  const payloadHashHex = await sha256Hex(rawBytes);
  const message = buildSignedMessage({ agentPubkey, timestampMs, displayName, payloadHashHex });

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = new Uint8Array(Buffer.from(signatureB64, "base64"));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid signature encoding" }, { status: 400 });
  }
  if (signatureBytes.length !== 64) {
    return NextResponse.json({ ok: false, error: "invalid signature length" }, { status: 400 });
  }
  if (!verifySignedMessage(message, signatureBytes, agentPubkey)) {
    return NextResponse.json({ ok: false, error: "signature verification failed" }, { status: 401 });
  }

  // Authorization: the signer must actually BE this agent's registered
  // on-chain authority, not merely a pubkey that signed something.
  const { agents } = await getAgentsSnapshot();
  const isRegisteredOwner = agents.some((a) => a.owner === agentPubkey);
  if (!isRegisteredOwner) {
    return NextResponse.json(
      { ok: false, error: "no registered Agent account found for this pubkey as owner" },
      { status: 403 }
    );
  }

  const result = await processPfpUpload(rawBytes);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const store = getPfpStore();
  const pfpUrl = await store.putImage(agentPubkey, result.processed, result.ext, result.contentType);
  await store.writeManifestEntry(agentPubkey, {
    pfpUrl,
    displayName: displayName || undefined,
    updatedAt: Date.now(),
  });

  return NextResponse.json({ ok: true, pfpUrl, displayName: displayName || undefined });
}
