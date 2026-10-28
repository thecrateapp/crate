import { useId, type ReactNode } from "react";
import type { CrateIcon } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

/** Panel and dashed are compatibility aliases of the inline V3 recipe. */
export type EmptyStateVariant = "inline" | "panel" | "dashed";
export type EmptyStateTitleLevel = "h2" | "h3" | "h4" | "p";

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  title?: ReactNode;
  description?: ReactNode;
  message?: ReactNode;
  /** @deprecated States use text instead of decorative icons. */
  icon?: CrateIcon | null;
  action?: ReactNode;
  titleAs?: EmptyStateTitleLevel;
  className?: string;
}

export function EmptyState({
  variant = "inline",
  title,
  description,
  message,
  action,
  titleAs: Title = "h3",
  className,
}: EmptyStateProps) {
  const id = useId();
  const body = description ?? message;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={!title && !body ? "Empty" : undefined}
      aria-labelledby={title ? `${id}-title` : body ? `${id}-body` : undefined}
      aria-describedby={title && body ? `${id}-body` : undefined}
      className={cn("crate-empty-state", className)}
      data-testid="empty-state"
      data-variant={variant}
    >
      {title ? (
        <Title
          id={`${id}-title`}
          className="m-0 font-mono text-label font-normal tracking-caps uppercase text-text-secondary"
        >
          {title}
        </Title>
      ) : null}
      {body ? (
        <p
          id={`${id}-body`}
          className="m-0 max-w-md text-sm leading-6 text-text-muted"
        >
          {body}
        </p>
      ) : null}
      {action ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
