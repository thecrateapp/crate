import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export type StatusDotTone = "on" | "off" | "warn";

const TONE_TEXT: Record<StatusDotTone, string> = {
  on: "text-accent-action-hi",
  off: "text-text-subtle",
  warn: "text-state-warning-text",
};

const TONE_DOT: Record<StatusDotTone, string> = {
  on: "bg-current",
  off: "border border-current",
  warn: "bg-current",
};

interface StatusDotProps {
  tone?: StatusDotTone;
  label?: ReactNode;
  title?: string;
  className?: string;
}

export function StatusDot({
  tone = "on",
  label,
  title,
  className,
}: StatusDotProps) {
  const dotOnly = !label && Boolean(title);

  return (
    <span
      data-tone={tone}
      title={title}
      role={dotOnly ? "img" : undefined}
      aria-label={dotOnly ? title : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 font-mono text-label uppercase tracking-caps",
        TONE_TEXT[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])}
      />
      {label}
    </span>
  );
}
