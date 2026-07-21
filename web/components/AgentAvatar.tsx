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
  const bg = `hsl(${identity.hue} 45% 15%)`;
  const border = `hsl(${identity.hue} 60% 40%)`;
  const fg = `hsl(${identity.hue} 70% 78%)`;

  return (
    <div
      className={
        "shrink-0 flex items-center justify-center rounded-sm border font-bold select-none transition-shadow duration-300" +
        (flash === "slash" ? " animate-slash-shake" : "")
      }
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: bg,
        borderColor: flash === "slash" ? "var(--danger)" : border,
        color: flash === "slash" ? "var(--danger)" : fg,
        boxShadow:
          flash === "slash"
            ? "0 0 0 2px rgba(226,55,58,0.35)"
            : flash === "settle"
              ? "0 0 0 2px rgba(224,161,0,0.3)"
              : undefined,
      }}
      title={identity.name}
    >
      {identity.glyph}
    </div>
  );
}
