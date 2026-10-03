import type { ReactNode } from "react";
import { Link, type To } from "react-router";

import type { CrateIcon } from "@crate/ui/icons";
import {
  AlertTriangle,
  ArrowLeft,
  Compass,
  CRATE_ICON_SIZE,
  Lock,
  RefreshCw,
} from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { Button } from "@crate/ui/shadcn/button";

export type ErrorStateKind = "error" | "notFound" | "unavailable";
export type ErrorStateTitleLevel = "h1" | "h2" | "h3" | "p";

export interface ErrorStateProps {
  kind?: ErrorStateKind;
  title?: ReactNode;
  message?: ReactNode;
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

const DEFAULT_ICON: Record<ErrorStateKind, CrateIcon> = {
  error: AlertTriangle,
  notFound: Compass,
  unavailable: Lock,
};

const ICON_CLASS_NAME: Record<ErrorStateKind, string> = {
  error: "text-state-danger-text",
  notFound: "text-text-muted",
  unavailable: "text-accent-action",
};

export function ErrorState({
  kind = "error",
  title,
  message,
  icon,
  onRetry,
  retryLabel = "Retry",
  backTo,
  backLabel = "Go back",
  action,
  titleAs: Title = "h2",
  className,
}: ErrorStateProps) {
  const Icon = icon === undefined ? DEFAULT_ICON[kind] : icon;
  const resolvedMessage =
    message ?? (title ? undefined : DEFAULT_MESSAGE[kind]);
  const hasActions = Boolean(onRetry || backTo !== undefined || action);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-24 text-center",
        className,
      )}
      data-testid="error-state"
      data-kind={kind}
      role={kind === "error" ? "alert" : undefined}
    >
      {Icon ? (
        <Icon
          size={32}
          aria-hidden="true"
          className={cn("mb-3", ICON_CLASS_NAME[kind])}
        />
      ) : null}
      {title ? (
        <Title className="mb-2 text-lg font-semibold text-text-primary">
          {title}
        </Title>
      ) : null}
      {resolvedMessage ? (
        <p className="text-text-muted mb-4 max-w-md">{resolvedMessage}</p>
      ) : null}
      {hasActions ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw size={CRATE_ICON_SIZE.sm} className="mr-1" />{" "}
              {retryLabel}
            </Button>
          )}
          {backTo !== undefined ? (
            <Link
              to={backTo}
              className="inline-flex items-center gap-2 rounded-sm text-sm text-accent-action outline-none hover:underline focus-visible:shadow-focus"
            >
              <ArrowLeft size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
              {backLabel}
            </Link>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
