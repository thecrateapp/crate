import type { ComponentProps, ReactNode } from "react";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { cn } from "@crate/ui/lib/cn";

export type SectionHeaderSize = "md" | "lg" | "display";
export type SectionHeaderLevel = "h1" | "h2" | "h3" | "h4";

export interface SectionHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
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

/** Shared caption for section navigation, including injected native links. */
export function SectionActionLabel({ children }: { children: ReactNode }) {
  return (
    <MonoLabel
      as="span"
      tone="accent"
      className="inline-flex items-center gap-2"
    >
      {children}
      <StatusDot className="drop-shadow-accent-action" />
    </MonoLabel>
  );
}

/** Text-aligned section action with a full-height target and no horizontal inset. */
export function SectionActionButton({
  children,
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      {...props}
      type={type}
      className={cn(
        "link-accent inline-flex min-h-11 items-center p-0 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <SectionActionLabel>{children}</SectionActionLabel>
    </button>
  );
}

export function SectionHeader({
  title,
  subtitle,
  eyebrow,
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
      <SectionActionButton onClick={onAction}>
        {actionLabel}
      </SectionActionButton>
    ) : null);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-start justify-between gap-3",
        className,
      )}
      data-testid="section-header"
      data-size={size}
    >
      <div className="grid min-w-0 flex-1 gap-2">
        {eyebrow !== undefined &&
        eyebrow !== null &&
        eyebrow !== false &&
        eyebrow !== "" ? (
          <MonoLabel>{eyebrow}</MonoLabel>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <Heading
            id={id}
            className={cn(
              "min-w-0 wrap-anywhere font-display leading-tight tracking-tight text-text-primary",
              TITLE_CLASS_NAME[size],
            )}
          >
            {title}
          </Heading>
          {hasCount ? (
            <span
              className="shrink-0 font-mono text-filter-chip font-normal tabular-nums text-text-subtle"
              data-testid="section-header-count"
            >
              {count}
            </span>
          ) : null}
        </div>
        {subtitle !== undefined &&
        subtitle !== null &&
        subtitle !== false &&
        subtitle !== "" ? (
          <p className="wrap-anywhere font-[family-name:var(--font-brand)] text-sm font-normal text-text-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      {resolvedAction ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
          {resolvedAction}
        </div>
      ) : null}
    </div>
  );
}
