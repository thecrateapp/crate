import { useId, type ReactNode } from "react";
import { Link, type To } from "react-router";
import type { CrateIcon } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";

export type ErrorStateKind = "error" | "notFound" | "unavailable";
export type ErrorStateTitleLevel = "h1" | "h2" | "h3" | "p";

export interface ErrorStateProps {
  variant?: "compact" | "page";
  kind?: ErrorStateKind;
  title?: ReactNode;
  message?: ReactNode;
  eyebrow?: ReactNode;
  statusCode?: number | string;
  /** @deprecated Error states no longer render decorative icons. */
  icon?: CrateIcon | null;
  onRetry?: () => void;
  retryLabel?: string;
  backTo?: To;
  backLabel?: string;
  action?: ReactNode;
  titleAs?: ErrorStateTitleLevel;
  className?: string;
}

const DEFAULT_MESSAGE: Record<ErrorStateKind, string> = {
  error: "Something went wrong",
  notFound: "We couldn't find what you were looking for",
  unavailable: "This is unavailable right now",
};
const DEFAULT_EYEBROW: Record<ErrorStateKind, string> = {
  error: "Error",
  notFound: "Not found",
  unavailable: "Unavailable",
};

export function ErrorState({
  variant = "compact",
  kind = "error",
  title,
  message,
  eyebrow,
  statusCode,
  onRetry,
  retryLabel = "Retry",
  backTo,
  backLabel = "Go back",
  action,
  titleAs: Title = "h2",
  className,
}: ErrorStateProps) {
  const id = useId();
  const body = message ?? (title ? undefined : DEFAULT_MESSAGE[kind]);
  return (
    <div
      className={cn(
        "crate-error-state",
        variant === "page" && "crate-error-page",
        className,
      )}
      data-testid="error-state"
      data-kind={kind}
      data-variant={variant}
      role={kind === "error" ? "alert" : "group"}
      aria-labelledby={`${id}-${title ? "title" : "message"}`}
      aria-describedby={title && body ? `${id}-message` : undefined}
    >
      {variant === "page" ? (
        <MonoLabel as="div" className="flex items-center gap-2">
          <StatusDot tone={kind === "notFound" ? "off" : "warn"} />
          <span>
            {eyebrow ?? DEFAULT_EYEBROW[kind]}
            {statusCode !== undefined ? ` · ${statusCode}` : null}
          </span>
        </MonoLabel>
      ) : null}
      {title ? (
        <div className="flex items-baseline gap-2">
          {variant === "compact" ? <StatusDot tone="warn" /> : null}
          <Title
            id={`${id}-title`}
            className={cn(
              "m-0 font-display text-text-primary",
              variant === "page"
                ? "crate-error-page-title"
                : "text-xl font-bold",
            )}
          >
            {title}
          </Title>
        </div>
      ) : null}
      {body ? (
        <p
          id={`${id}-message`}
          className="m-0 max-w-md text-sm leading-6 text-text-muted"
        >
          {body}
        </p>
      ) : null}
      {onRetry || backTo !== undefined || action ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {onRetry ? (
            <Button variant="ghost" shape="pill" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {backTo !== undefined ? (
            <Link
              to={backTo}
              className="link-accent inline-flex min-h-11 items-center text-sm"
            >
              {backLabel}
            </Link>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
