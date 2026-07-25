"use client";

// Root-level boundary — catches errors the layout itself throws (font
// loading, provider crash). Must render its own <html>/<body> since it
// replaces the whole document, so styling is inlined rather than relying
// on Tailwind/globals.css having mounted.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 16,
          textAlign: "center",
          background: "#15120D",
          color: "#ECE6DA",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: "0.22em", color: "#E2373A" }}>
          AUTARK IS DOWN
        </div>
        <p style={{ maxWidth: 420, fontSize: 12, lineHeight: 1.6, color: "#a49c88" }}>
          {error.message || "The app failed to render."}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            border: "1px solid #7a5c14",
            color: "#E0A100",
            background: "transparent",
            padding: "6px 12px",
            fontSize: 10,
            letterSpacing: "0.14em",
            borderRadius: 2,
            cursor: "pointer",
          }}
        >
          RETRY
        </button>
      </body>
    </html>
  );
}
