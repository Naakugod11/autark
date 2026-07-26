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
  // Light pastel fill + dark ink-toned glyph — legible on a bone page,
  // unlike the old dark-bg tile formula (light bg + light text would fail).
  const bg = `hsl(${identity.hue} 55% 88%)`;
  const border = `hsl(${identity.hue} 45% 60%)`;
  const fg = `hsl(${identity.hue} 65% 26%)`;

  return (
    <div
      className={
        "shrink-0 flex items-center justify-center border font-bold select-none transition-shadow duration-300" +
        (flash === "slash" ? " animate-slash-shake" : "")
      }
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: flash === "slash" ? "var(--ink)" : bg,
        borderColor: flash === "slash" ? "var(--danger)" : border,
        color: flash === "slash" ? "var(--bone)" : fg,
        boxShadow:
          flash === "slash"
            ? "0 0 0 2px var(--danger)"
            : flash === "settle"
              ? "0 0 0 2px var(--amber)"
              : undefined,
      }}
      title={identity.name}
    >
      {identity.glyph}
    </div>
  );
}
