import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export type StatNumberSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS_NAME: Record<StatNumberSize, string> = {
  sm: "text-numeral-sm font-bold leading-none tracking-numeral-sm",
  md: "text-numeral-md font-bold leading-none",
  lg: "text-numeral-lg font-extrabold leading-numeral tracking-numeral",
  xl: "text-numeral-xl font-extrabold leading-numeral tracking-numeral",
};

interface StatNumberProps {
  value: ReactNode;
  unit?: ReactNode;
  label?: ReactNode;
  labelPosition?: "above" | "below";
  size?: StatNumberSize;
  align?: "start" | "center";
  as?: "span" | "dd" | "div";
  className?: string;
}

export function StatNumber({
  value,
  unit,
  label,
  labelPosition = "below",
  size = "md",
  align = "start",
  as: Element = "span",
  className,
}: StatNumberProps) {
  const caption = label ? (
    <span className="font-mono font-normal text-label uppercase tracking-label text-text-subtle">
      {label}
    </span>
  ) : null;

  return (
    <Element
      className={cn(
        "m-0 inline-flex flex-col gap-1.5",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {labelPosition === "above" ? caption : null}
      <span className="inline-flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-display text-text-primary tabular-nums",
            SIZE_CLASS_NAME[size],
          )}
        >
          {value}
        </span>
        {unit != null ? (
          <span className="font-mono text-label font-normal text-text-subtle">
            {unit}
          </span>
        ) : null}
      </span>
      {labelPosition === "below" ? caption : null}
    </Element>
  );
}
