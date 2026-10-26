import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClassName: Record<StatusTone, string> = {
  neutral: "border-white/10 bg-white/[0.04] text-white/70",
  info: "border-cyan-400/25 bg-cyan-400/10 text-cyan-100",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  danger: "border-red-500/25 bg-red-500/10 text-red-200",
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
