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
        "border px-3 py-2.5 transition-colors duration-700 " +
        (flash ? "border-danger bg-danger-wash" : "border-ink-line bg-bone")
      }
    >
      <div
        className={
          "text-[19px] font-semibold tabular-nums " +
          (danger ? "text-danger-ink" : accent ? "text-amber-ink" : "text-ink")
        }
      >
        {value}
      </div>
      <div className="mt-0.5 text-[9px] tracking-[0.16em] text-ink-faint">{label}</div>
    </div>
  );
}
