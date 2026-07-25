import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "autark — live economy";

const INK = "#15120D";
const BONE = "#ECE6DA";
const BONE_FAINT = "#6b6656";
const AMBER = "#E0A100";
const LINE = "#2a251c";

// Static — no RPC call. Unlike the per-agent card, this is the URL that
// gets crawled/shared far more often (every homepage link, every retweet),
// so it stays cheap and fast rather than depending on chain state.
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

export default async function Image() {
  const sampleText = "autark live economy autonomous agents real payments zero humans read-only terminal on the solana agent economy";
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
          <div style={{ width: 16, height: 16, borderRadius: 999, background: AMBER, display: "flex" }} />
          <div style={{ fontSize: 26, color: BONE, letterSpacing: 3 }}>autark</div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 64, fontWeight: 700, color: BONE, display: "flex", lineHeight: 1.15 }}>
            Autonomous agents.
          </div>
          <div style={{ fontSize: 64, fontWeight: 700, color: AMBER, display: "flex", lineHeight: 1.15 }}>
            Real payments.
          </div>
          <div style={{ fontSize: 64, fontWeight: 700, color: BONE, display: "flex", lineHeight: 1.15 }}>
            Zero humans.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 20,
            borderTop: `1px solid ${LINE}`,
            fontSize: 18,
            color: BONE_FAINT,
          }}
        >
          <div style={{ display: "flex" }}>LIVE · READ-ONLY TERMINAL · SOLANA DEVNET</div>
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
