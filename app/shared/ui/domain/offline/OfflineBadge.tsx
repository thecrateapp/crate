import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Loader2,
} from "@crate/ui/icons";

import {
  getOfflineStateLabel,
  type OfflineItemState,
} from "@crate/ui/lib/offline";
import { cn } from "@crate/ui/lib/cn";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

interface OfflineBadgeProps {
  state: OfflineItemState;
  compact?: boolean;
  subtle?: boolean;
  className?: string;
}

export function OfflineBadge({
  state,
  compact = false,
  subtle = false,
  className,
}: OfflineBadgeProps) {
  if (state === "idle") return null;
  const label = getOfflineStateLabel(state);

  if (subtle) {
    const iconSize = compact ? 12 : 14;
    const icon =
      state === "ready" ? (
        <ArrowDownToLineBold size={iconSize} />
      ) : state === "error" ? (
        <AlertCircle size={iconSize} />
      ) : state === "queued" ? (
        <ArrowDownToLine size={iconSize} />
      ) : (
        <Loader2 size={iconSize} className="animate-spin" />
      );
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 align-middle",
          state === "ready"
            ? "text-[var(--status-ready-text)]"
            : state === "error"
              ? "text-[var(--status-error-text)]"
              : "text-accent-action/85",
          className,
        )}
      >
        {icon}
        {!compact ? <span className="text-xs font-medium">{label}</span> : null}
      </span>
    );
  }

  const badgeIcon =
    state === "ready"
      ? ArrowDownToLineBold
      : state === "error"
        ? AlertCircle
        : state === "queued"
          ? ArrowDownToLine
          : Loader2;

  return (
    <CrateBadge
      icon={badgeIcon}
      tone={state === "error" ? "danger" : "accent"}
      surface={compact ? "overlay" : "default"}
      title={compact && label ? label : undefined}
      className={cn(compact && "px-1.5", className)}
      iconClassName={badgeIcon === Loader2 ? "animate-spin" : undefined}
    >
      {!compact ? label : null}
    </CrateBadge>
  );
}
