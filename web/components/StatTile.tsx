export function StatTile({
  label,
  value,
  accent,
  danger,
  flash,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
  flash?: boolean;
}) {
  return (
    <div
      className={
        "border border-ink-line bg-ink px-3 py-2.5 transition-colors duration-700" +
        (flash ? " bg-danger-dim/40 border-danger" : "")
      }
    >
      <div
        className={
          "text-[19px] font-semibold tabular-nums " +
          (danger ? "text-danger" : accent ? "text-amber" : "text-bone")
        }
      >
        {value}
      </div>
      <div className="mt-0.5 text-[9px] tracking-[0.16em] text-bone-faint">{label}</div>
    </div>
  );
}
