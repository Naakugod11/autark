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
        <div style={{ fontSize: 13, letterSpacing: "0.22em", color: "#FF6B6B" }}>
          AUTARK IS DOWN
        </div>
        <p style={{ maxWidth: 420, fontSize: 12, lineHeight: 1.6, color: "#B6B1A7" }}>
          {error.message || "The app failed to render."}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            border: "1px solid #ECE6DA",
            color: "#15120D",
            background: "#ECE6DA",
            padding: "6px 12px",
            fontSize: 10,
            letterSpacing: "0.14em",
            cursor: "pointer",
          }}
        >
          RETRY
        </button>
      </body>
    </html>
  );
}
