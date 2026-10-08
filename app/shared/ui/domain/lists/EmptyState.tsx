import type { ReactNode } from "react";

import type { CrateIcon } from "@crate/ui/icons";
import { CRATE_ICON_SIZE, Music } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export type EmptyStateVariant = "inline" | "panel" | "dashed";
export type EmptyStateTitleLevel = "h2" | "h3" | "h4" | "p";

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  title?: ReactNode;
  description?: ReactNode;
  message?: ReactNode;
  icon?: CrateIcon | null;
  action?: ReactNode;
  titleAs?: EmptyStateTitleLevel;
  className?: string;
}

const ROOT_CLASS_NAME: Record<EmptyStateVariant, string> = {
  inline: "py-16",
  panel:
    "rounded-xl border border-text-primary/5 bg-text-primary/[0.02] px-6 py-16",
  dashed: "rounded-xl border border-dashed border-border-quiet px-5 py-12",
};

const TITLE_CLASS_NAME: Record<EmptyStateVariant, string> = {
  inline: "text-sm font-semibold text-text-primary",
  panel: "text-lg font-semibold text-text-primary",
  dashed: "text-base font-semibold text-text-primary",
};

export function EmptyState({
  variant = "panel",
  title,
  description,
  message,
  icon,
  action,
  titleAs: Title = "h3",
  className,
}: EmptyStateProps) {
  const Icon = icon === undefined ? (variant === "panel" ? Music : null) : icon;
  const body = description ?? message;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        ROOT_CLASS_NAME[variant],
        className,
      )}
      data-testid="empty-state"
      data-variant={variant}
    >
      {Icon ? (
        variant === "panel" ? (
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-border-quiet bg-text-primary/5 text-accent-action">
            <Icon size={CRATE_ICON_SIZE.xl} aria-hidden="true" />
          </div>
        ) : (
          <Icon
            size={CRATE_ICON_SIZE.xl}
            aria-hidden="true"
            className="mb-3 text-text-muted"
          />
        )
      ) : null}
      {title ? (
        <Title className={TITLE_CLASS_NAME[variant]}>{title}</Title>
      ) : null}
      {body ? (
        <p
          className={cn(
            "max-w-md text-sm text-text-muted",
            title ? "mt-2 leading-6" : null,
          )}
        >
          {body}
        </p>
      ) : null}
      {action ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}
