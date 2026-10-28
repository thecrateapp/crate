import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";

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
  pulse?: boolean;
  className?: string;
}

function PulsingDot({ className }: { className: string }) {
  const motionAllowed = useMotionAllowed();

  return (
    <span
      aria-hidden="true"
      className={cn(className, motionAllowed && "animate-pulse-subtle")}
    />
  );
}

export function StatusDot({
  tone = "on",
  label,
  title,
  pulse = false,
  className,
}: StatusDotProps) {
  const dotOnly = !label && Boolean(title);
  const dotClassName = cn(
    "crate-status-dot size-1.5 shrink-0 rounded-full",
    TONE_DOT[tone],
  );

  return (
    <TooltipHint content={title}>
      <span
        data-tone={tone}
        role={dotOnly ? "img" : undefined}
        aria-label={dotOnly ? title : undefined}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 font-mono text-label uppercase tracking-caps",
          TONE_TEXT[tone],
          className,
        )}
      >
        {pulse ? (
          <PulsingDot className={dotClassName} />
        ) : (
          <span aria-hidden="true" className={dotClassName} />
        )}
        {label}
      </span>
    </TooltipHint>
  );
}
