import type { ReactNode } from "react";

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={"flex flex-col border border-ink-line bg-ink-raised " + className}>
      <div className="flex items-center justify-between border-b border-ink-line px-3 py-2">
        <h2 className="text-[10px] font-semibold tracking-[0.22em] text-ink-dim">{title}</h2>
        {right}
      </div>
      <div className={"xl:min-h-0 xl:flex-1 " + bodyClassName}>{children}</div>
    </section>
  );
}
