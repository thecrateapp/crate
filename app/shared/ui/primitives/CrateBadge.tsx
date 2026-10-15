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
  variant?: "toggle" | "action" | "static";
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
  variant = onClick ? "toggle" : "static",
  disabled = false,
  icon: Icon,
  tone,
  className,
}: CratePillProps) {
  const pressed = variant === "toggle" && active;
  const classes = cn(
    "inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-transparent px-3 py-1 font-mono text-label tracking-chip [@media(pointer:coarse)]:min-h-11",
    pressed
      ? "border-accent-action-hi bg-accent-action-hi text-accent-action-hi-foreground"
      : tone
        ? TONE_CLASS_NAME[tone]
        : "border-border-subtle text-text-muted",
    variant !== "static" &&
      !pressed &&
      !disabled &&
      "hover:border-accent-action-hi/40 hover:text-text-primary",
    disabled && "cursor-not-allowed opacity-[var(--disabled-opacity)]",
  );

  if (variant !== "static") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={variant === "toggle" ? active : undefined}
        data-slot="chip"
        data-tone={tone}
        className={cn(
          classes,
          "crate-pill focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-action-hi",
          className,
        )}
      >
        {Icon && <Icon size={CRATE_ICON_SIZE.micro} />}
        {children}
      </button>
    );
  }
  return (
    <span className={cn(classes, className)} data-tone={tone} data-slot="chip">
      {Icon && <Icon size={CRATE_ICON_SIZE.micro} />}
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
        "inline-flex items-center gap-1 rounded-full border bg-transparent px-2 py-0.5 font-mono text-badge",
        active
          ? "border-[var(--chip-active-border)] bg-[var(--chip-active-bg)] text-[var(--active-text)]"
          : tone === "accent"
            ? "border-accent-action-hi/40 text-accent-action-hi"
            : tone
              ? TONE_CLASS_NAME[tone]
              : "border-[var(--chip-border)] bg-[var(--chip-bg)] text-[var(--idle-text-muted)]",
        className,
      )}
    >
      {Icon && <Icon size={CRATE_ICON_SIZE.micro} />}
      {children}
    </span>
  );
});
