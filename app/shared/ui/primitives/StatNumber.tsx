import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export type StatNumberSize = "sm" | "md" | "lg";

const SIZE_CLASS_NAME: Record<StatNumberSize, string> = {
  sm: "text-base sm:text-xl",
  md: "text-3xl",
  lg: "text-5xl",
};

interface StatNumberProps {
  value: ReactNode;
  label?: ReactNode;
  size?: StatNumberSize;
  align?: "start" | "center";
  className?: string;
}

export function StatNumber({
  value,
  label,
  size = "md",
  align = "start",
  className,
}: StatNumberProps) {
  return (
    <span
      className={cn(
        "inline-flex flex-col gap-1.5",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      <span
        className={cn(
          "font-display font-bold leading-none tracking-display text-text-primary tabular-nums",
          SIZE_CLASS_NAME[size],
        )}
      >
        {value}
      </span>
      {label ? (
        <span className="font-mono text-label uppercase tracking-label text-text-subtle">
          {label}
        </span>
      ) : null}
    </span>
  );
}
