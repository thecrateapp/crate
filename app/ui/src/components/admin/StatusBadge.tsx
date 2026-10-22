import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClassName: Record<StatusTone, string> = {
  neutral: "border-border-quiet bg-raised-surface text-text-subtle",
  info: "border-accent-action/25 bg-accent-action/10 text-accent-action",
  success: "border-accent-action/25 bg-accent-action/10 text-accent-action-hi",
  warning:
    "border-state-warning/25 bg-state-warning/10 text-state-warning-text",
  danger: "border-state-warning/25 bg-state-warning/10 text-state-warning-text",
};

export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClassName[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
