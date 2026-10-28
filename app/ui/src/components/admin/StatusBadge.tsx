import type { ReactNode } from "react";
import { InfoBadge, type InfoBadgeTone } from "@crate/ui/primitives/InfoBadge";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

// Admin's operational vocabulary keeps its reviewed accent/warning semantics.
const visualTone: Record<StatusTone, InfoBadgeTone> = {
  neutral: "neutral",
  info: "accent",
  success: "accent",
  warning: "warning",
  danger: "warning",
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
    <InfoBadge
      data-status-tone={tone}
      tone={visualTone[tone]}
      className={className}
    >
      {children}
    </InfoBadge>
  );
}
