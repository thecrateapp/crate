import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

interface HairlineListProps {
  as?: "ol" | "ul";
  label?: string;
  children: ReactNode;
  className?: string;
}

export function HairlineList({
  as: Element = "ol",
  label,
  children,
  className,
}: HairlineListProps) {
  return (
    <Element aria-label={label} className={cn("m-0 list-none p-0", className)}>
      {children}
    </Element>
  );
}

interface HairlineRowProps {
  index?: number;
  trailing?: ReactNode;
  muted?: boolean;
  children: ReactNode;
  className?: string;
}

export function formatRowIndex(index: number): string {
  return String(index).padStart(2, "0");
}

export function HairlineRow({
  index,
  trailing,
  muted = false,
  children,
  className,
}: HairlineRowProps) {
  return (
    <li
      data-muted={muted || undefined}
      className={cn(
        "flex items-baseline gap-3.5 border-b border-border-quiet-subtle py-2.5",
        className,
      )}
    >
      {index != null ? (
        <span className="w-[3ch] shrink-0 font-mono text-label text-text-subtle tabular-nums">
          {formatRowIndex(index)}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          muted ? "text-text-subtle" : "text-text-primary",
        )}
      >
        {children}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </li>
  );
}
