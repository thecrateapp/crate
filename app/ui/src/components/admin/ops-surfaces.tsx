import type { ComponentProps, ReactNode } from "react";
import { PageHeaderLayout } from "../layout/PageHeader";

import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Button } from "@crate/ui/shadcn/button";

type OpsTone = "default" | "primary" | "success" | "warning" | "danger";

function valueToneClass(tone: OpsTone) {
  switch (tone) {
    case "success":
      return "text-accent-action-hi";
    case "warning":
    case "danger":
      return "text-state-warning-text";
    default:
      return "text-text-primary";
  }
}

export function OpsPageHero({
  title,
  description,
  actions,
  children,
  className,
  compactActions = false,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  compactActions?: boolean;
}) {
  const identity = (
    <div className="space-y-4">
      <div>
        <h1 className="m-0 font-display text-[clamp(2.25rem,4vw,3.75rem)] font-extrabold leading-display tracking-[-0.045em] text-balance text-text-primary">
          {title}
        </h1>
        <p className="mt-3 text-sm text-white/55">{description}</p>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
  return (
    <AdminPageHeader className={className}>
      {compactActions ? (
        <PageHeaderLayout actions={actions}>{identity}</PageHeaderLayout>
      ) : (
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          {identity}
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      )}
    </AdminPageHeader>
  );
}

export function AdminPageHeader({
  className,
  ...props
}: ComponentProps<"header">) {
  return (
    <header
      {...props}
      data-slot="admin-page-header-container"
      className={cn("min-w-0", className)}
    />
  );
}

export function OpsStatTile({
  label,
  value,
  caption,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: OpsTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "@container rounded-md border border-border-quiet bg-raised-surface p-4 shadow-none",
        className,
      )}
    >
      <div className="crate-form-field">
        <MonoLabel as="div">{label}</MonoLabel>
        <div
          className={cn(
            "font-mono text-numeral-md font-normal leading-none tabular-nums",
            valueToneClass(tone),
          )}
        >
          {value}
        </div>
      </div>
      {caption ? (
        <div className="mt-1 text-xs text-white/40">{caption}</div>
      ) : null}
    </div>
  );
}

type OpsSurfaceProps = ComponentProps<"div"> & {
  as?: "article" | "div";
};

export function OpsSurface({
  as: Element = "div",
  className,
  ...props
}: OpsSurfaceProps) {
  return (
    <Element
      {...props}
      className={cn(
        "min-w-0 rounded-md border border-border-quiet bg-raised-surface shadow-none",
        className,
      )}
    />
  );
}

export function OpsPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <InstrumentPanel
      as="section"
      headingLevel={2}
      label={{ children: title }}
      description={description}
      actions={action}
      className={className}
    >
      {children}
    </InstrumentPanel>
  );
}

export type OpsStreamStatus = "connecting" | "live" | "reconnecting" | "paused";

export function OpsSnapshotStatus({
  snapshot,
  streamStatus,
}: {
  snapshot: { stale?: boolean; built_at?: string | null } | null | undefined;
  streamStatus: OpsStreamStatus;
}) {
  const freshnessLabel = snapshot?.stale
    ? "Snapshot stale"
    : "Snapshot current";
  const freshnessTitle = snapshot?.built_at
    ? `Snapshot built ${new Date(snapshot.built_at).toLocaleString()}`
    : undefined;
  const streamLabel = {
    connecting: "Connecting",
    live: "Live updates",
    reconnecting: "Reconnecting",
    paused: "Live updates paused",
  }[streamStatus];

  return (
    <>
      {snapshot ? (
        <InfoBadge
          tone={snapshot.stale ? "warning" : "neutral"}
          title={freshnessTitle}
        >
          {freshnessLabel}
        </InfoBadge>
      ) : null}
      <InfoBadge
        tone={
          streamStatus === "live"
            ? "success"
            : streamStatus === "reconnecting"
              ? "warning"
              : "neutral"
        }
      >
        {streamLabel}
      </InfoBadge>
    </>
  );
}

export function OpsRefreshNotice({
  message,
  onRetry,
  retrying = false,
  className,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-slot="ops-refresh-notice"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border border-state-warning/25 bg-state-warning/[0.06] px-4 py-3 text-sm text-text-secondary",
        className,
      )}
    >
      <span>{message}</span>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11"
        onClick={onRetry}
        disabled={retrying}
        aria-busy={retrying || undefined}
      >
        {retrying ? "Retrying" : "Retry"}
      </Button>
    </div>
  );
}
