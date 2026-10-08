import { memo, type ComponentType, type ReactNode } from "react";

import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export type CrateBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

const TONE_CLASS_NAME: Record<CrateBadgeTone, string> = {
  neutral: "border-border-subtle bg-surface-control text-text-secondary",
  info: "border-state-info/25 bg-state-info/10 text-state-info",
  success:
    "border-state-success/25 bg-state-success/10 text-state-success-text",
  warning:
    "border-state-warning/25 bg-state-warning/10 text-state-warning-text",
  danger: "border-state-danger/25 bg-state-danger/10 text-state-danger-text",
  accent: "border-accent-action/25 bg-accent-action/10 text-accent-action",
};

const ICON_TONE_CLASS_NAME: Record<CrateBadgeTone, string> = {
  neutral: "text-text-muted",
  info: "text-state-info",
  success: "text-state-success-text",
  warning: "text-state-warning-text",
  danger: "text-state-danger-text",
  accent: "text-accent-action",
};

export type CrateBadgeSize = "sm" | "md";

export type CrateBadgeSurface = "default" | "overlay";

interface CrateBadgeProps {
  children: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  tone?: CrateBadgeTone;
  size?: CrateBadgeSize;
  surface?: CrateBadgeSurface;
  title?: string;
  className?: string;
  iconClassName?: string;
}

export const CrateBadge = memo(function CrateBadge({
  children,
  icon: Icon,
  tone = "accent",
  size = "sm",
  surface = "default",
  title,
  className,
  iconClassName,
}: CrateBadgeProps) {
  return (
    <span
      title={title}
      data-tone={tone}
      data-surface={surface}
      className={cn(
        "crate-badge inline-flex min-w-0 max-w-full shrink-0 items-center gap-1.5 rounded-md border",
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-1 text-badge",
        className,
      )}
    >
      {Icon ? (
        <Icon
          size={size === "md" ? CRATE_ICON_SIZE.xs : CRATE_ICON_SIZE.micro}
          className={cn("shrink-0", ICON_TONE_CLASS_NAME[tone], iconClassName)}
        />
      ) : null}
      {children}
    </span>
  );
});

interface CratePillProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ComponentType<{ size: number }>;
  tone?: CrateBadgeTone;
  className?: string;
}

export const CratePill = memo(function CratePill({
  children,
  active = false,
  onClick,
  disabled = false,
  icon: Icon,
  tone,
  className,
}: CratePillProps) {
  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-badge transition",
    active
      ? "border-[var(--pill-active-border)] bg-[var(--pill-active-bg)] text-[var(--active-text)]"
      : tone
        ? TONE_CLASS_NAME[tone]
        : "border-[var(--pill-border)] bg-[var(--pill-bg)] text-[var(--idle-text)] hover:border-[var(--hover-border)] hover:text-text-primary",
    disabled && "cursor-not-allowed opacity-[var(--disabled-opacity)]",
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={active}
        data-tone={tone}
        className={cn(
          classes,
          "outline-none focus-visible:shadow-focus",
          className,
        )}
      >
        {Icon && <Icon size={11} />}
        {children}
      </button>
    );
  }
  return (
    <span className={cn(classes, className)} data-tone={tone}>
      {Icon && <Icon size={11} />}
      {children}
    </span>
  );
});

interface CrateChipProps {
  children: ReactNode;
  active?: boolean;
  icon?: ComponentType<{ size: number }>;
  tone?: CrateBadgeTone;
  className?: string;
}

export const CrateChip = memo(function CrateChip({
  children,
  active = false,
  icon: Icon,
  tone,
  className,
}: CrateChipProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-badge",
        active
          ? "border-[var(--chip-active-border)] bg-[var(--chip-active-bg)] text-[var(--active-text)]"
          : tone
            ? TONE_CLASS_NAME[tone]
            : "border-[var(--chip-border)] bg-[var(--chip-bg)] text-[var(--idle-text-muted)]",
        className,
      )}
    >
      {Icon && <Icon size={10} />}
      {children}
    </span>
  );
});
