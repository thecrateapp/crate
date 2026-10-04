import type { ReactNode } from "react";

import { ArrowRight, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export type SectionHeaderSize = "md" | "lg" | "display";
export type SectionHeaderLevel = "h1" | "h2" | "h3" | "h4";

export interface SectionHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  count?: ReactNode;
  id?: string;
  as?: SectionHeaderLevel;
  size?: SectionHeaderSize;
  className?: string;
}

const TITLE_CLASS_NAME: Record<SectionHeaderSize, string> = {
  md: "text-lg font-bold",
  lg: "text-2xl font-bold",
  display: "text-3xl font-bold tracking-tight",
};

const COUNT_CLASS_NAME: Record<SectionHeaderSize, string> = {
  md: "text-sm",
  lg: "text-base",
  display: "text-base",
};

export function SectionHeader({
  title,
  subtitle,
  action,
  actionLabel,
  onAction,
  count,
  id,
  as: Heading = "h2",
  size = "md",
  className,
}: SectionHeaderProps) {
  const hasCount = count !== undefined && count !== null && count !== false;
  const resolvedAction =
    action ??
    (actionLabel && onAction ? (
      <button
        type="button"
        onClick={onAction}
        className="link-accent inline-flex items-center gap-1 text-sm outline-none"
      >
        {actionLabel}
        <ArrowRight size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
      </button>
    ) : null);

  return (
    <div
      className={cn("flex items-end justify-between gap-3", className)}
      data-testid="section-header"
      data-size={size}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <Heading
            id={id}
            className={cn(
              "min-w-0 leading-tight text-text-primary",
              TITLE_CLASS_NAME[size],
            )}
          >
            {title}
          </Heading>
          {hasCount ? (
            <span
              className={cn(
                "shrink-0 font-medium tabular-nums text-text-muted",
                COUNT_CLASS_NAME[size],
              )}
              data-testid="section-header-count"
            >
              {count}
            </span>
          ) : null}
        </div>
        {subtitle ? (
          <p className="mt-1 line-clamp-2 text-sm text-text-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      {resolvedAction ? (
        <div className="flex shrink-0 items-center gap-2">{resolvedAction}</div>
      ) : null}
    </div>
  );
}
