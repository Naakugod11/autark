import { ImageResponse } from "next/og";
import { getAgentAccount, getAgentBadges } from "@/lib/agentProfile";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "autark agent profile card";
// See the matching comment in ./page.tsx — forces request-time rendering so
// `next build` never attempts to prerender this. Caching lives in
// web/lib/chainCache.ts, shared with the profile page and the landing page.
export const dynamic = "force-dynamic";

const INK = "#15120D";
const BONE = "#ECE6DA";
const BONE_FAINT = "#8B877E";
const AMBER_INK = "#F5C518"; // bright amber — reads fine as text directly on Ink — money only
const DANGER_INK = "#FF6B6B"; // bright danger — slash count only
const LINE = "#4B4740";

// Best-effort brand font — satori needs an explicit font file for any
// non-default family. If the fetch fails (offline build, blocked network),
// fall back to satori's built-in default rather than failing the route.
async function loadMonoFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&text=${encodeURIComponent(text)}`;
    const css = await fetch(cssUrl).then((r) => r.text());
    const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/);
    if (!match) return null;
    const res = await fetch(match[1]);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

function fmt(micro: number): string {
  return (micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TIER_HEX: Record<string, string> = {
  bronze: "#7A5C14",
  silver: "#B6B1A7",
  gold: "#E0A100",
  platinum: BONE,
};

// satori (next/og) renders server-side with no browser location to resolve
// a relative URL against — the fs backend's avatarUrl (e.g.
// "/uploads/pfp/xyz.png") needs the deployed origin prepended. Vercel Blob
// URLs are already absolute and pass through untouched.
function toAbsoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//.test(url)) return url;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${base}${url}`;
}

export default async function Image({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await params;
  const [profile, badges] = await Promise.all([getAgentAccount(pubkey), getAgentBadges(pubkey)]);
  const avatarAbsUrl = toAbsoluteUrl(profile.identity.avatarUrl);

  const total = profile.scoreCompleted + profile.scoreFailed;
  const clean = total === 0 ? 100 : Math.round((profile.scoreCompleted / total) * 100);
  const slashColor = profile.slashEvents > 0 ? DANGER_INK : BONE;

  const sampleText = `autark ${profile.identity.name} #${profile.ranks.volume.rank} $${fmt(profile.scoreVolume)} ${profile.slashEvents} ${clean}% LIVE SOLANA DEVNET AGENT ECONOMY TERMINAL RANK OF SLASHES EARNED CLEAN 0123456789 ${badges.reputation.map((b) => b.label).join(" ")} ${badges.vanity.map((b) => b.label).join(" ")}`;
  const fontData = await loadMonoFont(sampleText);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: INK,
          padding: 64,
          fontFamily: fontData ? "JetBrains Mono" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 16, height: 16, background: BONE, display: "flex" }} />
          <div style={{ fontSize: 26, color: BONE, letterSpacing: 3 }}>autark</div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {avatarAbsUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- satori (next/og) needs a raw <img>, not next/image
              <img
                src={avatarAbsUrl}
                width={96}
                height={96}
                alt=""
                style={{ border: `2px solid ${BONE_FAINT}`, objectFit: "cover" }}
              />
            )}
            <div style={{ fontSize: 76, fontWeight: 700, color: BONE, display: "flex" }}>
              {profile.identity.name}
            </div>
          </div>

          {(badges.reputation.length > 0 || badges.vanity.length > 0) && (
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              {badges.reputation.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    border: `2px solid ${TIER_HEX[b.tier]}`,
                    color: TIER_HEX[b.tier],
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: 1,
                    padding: "6px 12px",
                  }}
                >
                  {b.label}
                </div>
              ))}
              {badges.vanity.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    border: `2px dashed ${BONE_FAINT}`,
                    color: BONE_FAINT,
                    fontSize: 16,
                    letterSpacing: 1,
                    padding: "6px 12px",
                  }}
                >
                  {b.label}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 20, marginTop: 40 }}>
            {profile.found ? (
              <>
                <StatBox label={`RANK OF ${profile.ranks.volume.total}`} value={`#${profile.ranks.volume.rank}`} color={BONE} />
                <StatBox label="EARNED" value={`$${fmt(profile.scoreVolume)}`} color={AMBER_INK} />
                <StatBox
                  label={profile.slashEvents === 1 ? "SLASH" : "SLASHES"}
                  value={String(profile.slashEvents)}
                  color={slashColor}
                />
                <StatBox label="CLEAN RECORD" value={`${clean}%`} color={BONE} />
              </>
            ) : (
              <StatBox label="STATUS" value="UNREGISTERED" color={BONE_FAINT} />
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, color: BONE_FAINT }}>
          <div style={{ display: "flex" }}>LIVE · SOLANA DEVNET</div>
          <div style={{ display: "flex" }}>AGENT ECONOMY TERMINAL</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fontData ? [{ name: "JetBrains Mono", data: fontData, style: "normal", weight: 500 }] : undefined,
    }
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${LINE}`,
        padding: "18px 26px",
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 40, fontWeight: 700, color, display: "flex" }}>{value}</div>
      <div style={{ fontSize: 15, color: BONE_FAINT, letterSpacing: 2, marginTop: 6, display: "flex" }}>
        {label}
      </div>
    </div>
  );
}
