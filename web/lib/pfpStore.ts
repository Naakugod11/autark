/**
 * web/lib/pfpStore.ts — storage adapter for Task 4's uploaded PFPs +
 * display names, selected by the PFP_STORE env var.
 *
 *   - "fs" (default, dev): writes under public/uploads/pfp/, served
 *     directly by Next's static file handling — no extra route needed.
 *     Vercel's serverless filesystem is EPHEMERAL per invocation, so this
 *     backend only makes sense for local dev / a single long-lived
 *     `next start` process, never a serverless prod deploy.
 *   - "blob" (prod): Vercel Blob (@vercel/blob), dynamically imported so a
 *     dev environment with PFP_STORE unset (or "fs") never needs the
 *     package configured/reachable.
 *
 * Both backends store the SAME two things: the image itself, and a JSON
 * manifest mapping owner pubkey -> {pfpUrl, displayName, updatedAt} — the
 * one piece of durable state this otherwise-stateless dashboard needs.
 * Manifest reads go through web/lib/identityOverrides.ts's cached wrapper;
 * this module only knows how to get bytes in and the manifest in/out.
 *
 * fs/path are static imports (always available server-side, in both Node
 * API routes and this being a "nodejs" runtime module) — only @vercel/blob
 * below is dynamically imported, since that one is a real optional
 * dependency this module shouldn't need to touch unless PFP_STORE=blob.
 */

import * as fs from "fs/promises";
import * as path from "path";

export type ManifestEntry = { pfpUrl: string; displayName?: string; updatedAt: number };
export type Manifest = Record<string, ManifestEntry>;

export interface PfpStore {
  putImage(owner: string, bytes: Buffer, ext: string, contentType: string): Promise<string>;
  readManifest(): Promise<Manifest>;
  writeManifestEntry(owner: string, entry: ManifestEntry): Promise<void>;
}

// ── Filesystem backend ──────────────────────────────────────────────────────

const FS_ROOT = path.join(process.cwd(), "public", "uploads", "pfp");
const FS_MANIFEST_PATH = path.join(FS_ROOT, "manifest.json");

class FsPfpStore implements PfpStore {
  private async ensureDir() {
    await fs.mkdir(FS_ROOT, { recursive: true });
  }

  async putImage(owner: string, bytes: Buffer, ext: string): Promise<string> {
    await this.ensureDir();
    const filename = `${owner}.${ext}`;
    await fs.writeFile(path.join(FS_ROOT, filename), bytes);
    // Cache-bust query param so a re-upload with the same filename isn't
    // served stale from the browser's HTTP cache.
    return `/uploads/pfp/${filename}?v=${Date.now()}`;
  }

  async readManifest(): Promise<Manifest> {
    await this.ensureDir();
    try {
      const raw = await fs.readFile(FS_MANIFEST_PATH, "utf-8");
      return JSON.parse(raw) as Manifest;
    } catch {
      return {};
    }
  }

  async writeManifestEntry(owner: string, entry: ManifestEntry): Promise<void> {
    await this.ensureDir();
    const manifest = await this.readManifest();
    manifest[owner] = entry;
    await fs.writeFile(FS_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }
}

// ── Vercel Blob backend ──────────────────────────────────────────────────────

const BLOB_MANIFEST_PATHNAME = "pfp/manifest.json";

class BlobPfpStore implements PfpStore {
  async putImage(owner: string, bytes: Buffer, ext: string, contentType: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const blob = await put(`pfp/${owner}.${ext}`, bytes, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return blob.url;
  }

  async readManifest(): Promise<Manifest> {
    const { head } = await import("@vercel/blob");
    try {
      const info = await head(BLOB_MANIFEST_PATHNAME);
      const res = await fetch(info.url, { cache: "no-store" });
      if (!res.ok) return {};
      return (await res.json()) as Manifest;
    } catch {
      return {};
    }
  }

  async writeManifestEntry(owner: string, entry: ManifestEntry): Promise<void> {
    const { put } = await import("@vercel/blob");
    const manifest = await this.readManifest();
    manifest[owner] = entry;
    await put(BLOB_MANIFEST_PATHNAME, JSON.stringify(manifest, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }
}

let _store: PfpStore | null = null;

export function getPfpStore(): PfpStore {
  if (_store) return _store;
  const backend = process.env.PFP_STORE ?? "fs";
  _store = backend === "blob" ? new BlobPfpStore() : new FsPfpStore();
  return _store;
}
