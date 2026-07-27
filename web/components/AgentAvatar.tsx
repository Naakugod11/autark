import type { AgentIdentity } from "@/lib/identity";

export function AgentAvatar({
  identity,
  size = 32,
  flash,
}: {
  identity: AgentIdentity;
  size?: number;
  flash?: "slash" | "settle" | null;
}) {
  // Light pastel fill + dark ink-toned glyph — still legible sitting on the
  // dark page (colorful chips read fine against Ink), so this formula is
  // unchanged from the light system.
  const bg = `hsl(${identity.hue} 55% 88%)`;
  const border = `hsl(${identity.hue} 45% 60%)`;
  const fg = `hsl(${identity.hue} 65% 26%)`;

  const baseClassName =
    "shrink-0 flex items-center justify-center border font-bold select-none transition-shadow duration-300" +
    (flash === "slash" ? " animate-slash-shake" : "");

  const boxShadow =
    flash === "slash" ? "0 0 0 2px var(--amber)" : flash === "settle" ? "0 0 0 2px var(--amber)" : undefined;

  // Task 4's signed-upload PFP takes precedence over the generated glyph
  // tile — a plain <img>, not next/image, so this also works unmodified in
  // the OG image's satori renderer and regardless of which storage backend
  // (fs path or a Vercel Blob URL) produced the URL.
  if (identity.avatarUrl) {
    return (
      <img
        src={identity.avatarUrl}
        alt={identity.name}
        title={identity.name}
        className={baseClassName + " object-cover"}
        style={{
          width: size,
          height: size,
          borderColor: flash === "slash" ? "var(--danger)" : border,
          boxShadow,
        }}
      />
    );
  }

  return (
    <div
      className={baseClassName}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        // Slash flash needs its own fill — Ink is the page's own surface
        // now, so it would be invisible here; danger-red reads as intended.
        background: flash === "slash" ? "var(--danger)" : bg,
        borderColor: flash === "slash" ? "var(--danger)" : border,
        color: flash === "slash" ? "var(--bone)" : fg,
        boxShadow,
      }}
      title={identity.name}
    >
      {identity.glyph}
    </div>
  );
}
