import { ImageResponse } from "next/og";
import { getAgentAccount } from "@/lib/agentProfile";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "autark agent profile card";
// See the matching comment in ./page.tsx — same RPC-load rationale, same
// staleness tradeoff, applied to the image route social crawlers hit directly.
export const revalidate = 60;

const BONE = "#F2EEE6";
const INK = "#15120D";
const INK_FAINT = "#6b6656";
const AMBER_INK = "#7A5C14"; // amber deep enough to read as text on bone — money only
const DANGER_INK = "#8F1D24"; // slash count only
const LINE = "#C4B9A0";

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

export default async function Image({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await params;
  const profile = await getAgentAccount(pubkey);

  const total = profile.scoreCompleted + profile.scoreFailed;
  const clean = total === 0 ? 100 : Math.round((profile.scoreCompleted / total) * 100);
  const slashColor = profile.slashEvents > 0 ? DANGER_INK : INK;

  const sampleText = `autark ${profile.identity.name} #${profile.ranks.volume.rank} $${fmt(profile.scoreVolume)} ${profile.slashEvents} ${clean}% LIVE SOLANA DEVNET AGENT ECONOMY TERMINAL RANK OF SLASHES EARNED CLEAN 0123456789`;
  const fontData = await loadMonoFont(sampleText);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: BONE,
          padding: 64,
          fontFamily: fontData ? "JetBrains Mono" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 16, height: 16, background: INK, display: "flex" }} />
          <div style={{ fontSize: 26, color: INK, letterSpacing: 3 }}>autark</div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 76, fontWeight: 700, color: INK, display: "flex" }}>
            {profile.identity.name}
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 40 }}>
            {profile.found ? (
              <>
                <StatBox label={`RANK OF ${profile.ranks.volume.total}`} value={`#${profile.ranks.volume.rank}`} color={INK} />
                <StatBox label="EARNED" value={`$${fmt(profile.scoreVolume)}`} color={AMBER_INK} />
                <StatBox
                  label={profile.slashEvents === 1 ? "SLASH" : "SLASHES"}
                  value={String(profile.slashEvents)}
                  color={slashColor}
                />
                <StatBox label="CLEAN RECORD" value={`${clean}%`} color={INK} />
              </>
            ) : (
              <StatBox label="STATUS" value="UNREGISTERED" color={INK_FAINT} />
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, color: INK_FAINT }}>
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
      <div style={{ fontSize: 15, color: INK_FAINT, letterSpacing: 2, marginTop: 6, display: "flex" }}>
        {label}
      </div>
    </div>
  );
}
