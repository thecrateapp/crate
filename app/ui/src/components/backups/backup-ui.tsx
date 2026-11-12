// Backups building blocks, composed only from shared primitives and tokens.
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  CRATE_ICON_SIZE,
  CloudStorage,
  Copy,
  FolderCloud,
  ServerPath,
  SsdRound,
} from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { FormField } from "@crate/ui/primitives/FormField";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import {
  SeverityMeter,
  severityTextClass,
} from "@/components/admin/status-indicators";
import {
  HEALTH_LABEL,
  RUN_STATUS_LABEL,
  type BackupHealth,
  type BackupKind,
  type BackupRunStatus,
} from "@/lib/backups";

/** The destination kind's Solar mark (BG1-2). Decorative: the kind is also text. */
export function KindMark({
  kind,
  className,
}: {
  kind: BackupKind;
  className?: string;
}) {
  const glyphClass = cn("shrink-0 text-text-secondary", className);
  switch (kind) {
    case "local":
      return (
        <SsdRound
          data-admin-ux="backup-kind-volume"
          aria-hidden="true"
          size={CRATE_ICON_SIZE.lg}
          className={glyphClass}
        />
      );
    case "s3":
    case "b2":
      return (
        <CloudStorage
          data-admin-ux="backup-kind-object-storage"
          aria-hidden="true"
          size={CRATE_ICON_SIZE.lg}
          className={glyphClass}
        />
      );
    case "sftp":
      return (
        <ServerPath
          data-admin-ux="backup-kind-sftp"
          aria-hidden="true"
          size={CRATE_ICON_SIZE.lg}
          className={glyphClass}
        />
      );
    default:
      return (
        <FolderCloud
          data-admin-ux="backup-kind-cloud-drive"
          aria-hidden="true"
          size={CRATE_ICON_SIZE.lg}
          className={glyphClass}
        />
      );
  }
}

const HEALTH_TONE: Record<
  Exclude<BackupHealth, "failing">,
  "on" | "off" | "warn"
> = {
  healthy: "on",
  late: "warn",
  untested: "off",
  disabled: "off",
};

/** Failing is red (BG1-3), late amber, healthy accent, the rest quiet. */
export function HealthDot({ health }: { health: BackupHealth }) {
  if (health === "failing")
    return <SeverityMeter level="error" label={HEALTH_LABEL.failing} />;
  return <StatusDot tone={HEALTH_TONE[health]} label={HEALTH_LABEL[health]} />;
}

/** Successful runs stay quiet (BG1-14), so failed and running ones stand out. */
export function RunStatusDot({ status }: { status: BackupRunStatus }) {
  if (status === "failed")
    return <SeverityMeter level="error" label={RUN_STATUS_LABEL.failed} />;
  if (status === "running")
    return <StatusDot tone="on" pulse label={RUN_STATUS_LABEL.running} />;
  return <StatusDot tone="off" label={RUN_STATUS_LABEL.succeeded} />;
}

/** The Settings section recipe: accent MonoLabel heading, muted description. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("min-w-0 space-y-4", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <MonoLabel as="h3" tone="accent" id={headingId}>
            {title}
          </MonoLabel>
          {description ? (
            <p className="text-sm text-text-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label and value pairs in the mono metadata recipe. */
export function Facts({
  items,
  className,
}: {
  items: { label: string; value: ReactNode; tone?: "warning" | "danger" }[];
  className?: string;
}) {
  return (
    <dl className={cn("m-0 grid grid-cols-2 gap-x-4 gap-y-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="font-mono text-label uppercase tracking-caps text-text-subtle">
            {item.label}
          </dt>
          <dd
            className={cn(
              "m-0 mt-1 truncate font-mono text-sm tabular-nums",
              item.tone === "danger"
                ? severityTextClass("error")
                : item.tone === "warning"
                  ? "text-state-warning-text"
                  : "text-text-primary",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Result of "Test connection": passing, failing (red), not run or running. */
export function TestResult({
  ok,
  title,
  lines,
  when,
  running = false,
}: {
  ok: boolean | null;
  title: string;
  lines: ReactNode[];
  when?: ReactNode;
  running?: boolean;
}) {
  return (
    <div
      role="status"
      aria-busy={running || undefined}
      className={cn(
        "space-y-2 rounded-md border p-4",
        ok === false
          ? "border-border-quiet bg-raised-surface"
          : ok
            ? "border-border-quiet bg-raised-surface"
            : "border-dashed border-border-quiet",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {ok === false ? (
          <SeverityMeter level="error" label={title} />
        ) : (
          <StatusDot
            tone={ok || running ? "on" : "off"}
            pulse={running}
            label={title}
          />
        )}
        {when ? (
          <span className="font-mono text-label text-text-subtle">{when}</span>
        ) : null}
      </div>
      {lines.length ? (
        <ul className="m-0 list-none space-y-1 p-0">
          {lines.map((line, index) => (
            <li
              key={index}
              className={cn(
                "text-sm",
                ok === false
                  ? severityTextClass("error")
                  : "text-text-secondary",
              )}
            >
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A write-only secret. Once saved it shows "Saved" and Replace, never the value;
 * Replace swaps in an empty input for the new value.
 */
export function SecretField({
  label,
  saved,
  savedText = "Write-only. Never shown again.",
  hint,
  placeholder,
  value,
  onChange,
  error,
}: {
  label: string;
  saved: boolean;
  savedText?: string;
  hint?: ReactNode;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  error?: ReactNode;
}) {
  const [replacing, setReplacing] = useState(false);
  if (saved && !replacing)
    return (
      <FormField label={label} hint={hint} kind="group">
        {(control) => (
          <div
            id={control.id}
            aria-labelledby={control["aria-labelledby"]}
            aria-describedby={control["aria-describedby"]}
            role="group"
            className="flex min-h-10 flex-wrap items-center gap-3 rounded-md border border-border-quiet px-3 py-1.5"
          >
            <InfoBadge tone="accent">Saved</InfoBadge>
            <span className="min-w-0 flex-1 truncate font-mono text-label text-text-subtle">
              {savedText}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Replace ${label.toLowerCase()}`}
              onClick={() => setReplacing(true)}
            >
              Replace
            </Button>
          </div>
        )}
      </FormField>
    );
  return (
    <FormField label={label} hint={hint} error={error}>
      <Input
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        placeholder={placeholder ?? (saved ? "New value" : undefined)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

/** Copy a value to the clipboard with the shared 44 px icon action. */
export function CopyAction({ value, label }: { value: string; label: string }) {
  async function copy() {
    if (!navigator.clipboard) {
      toast.error("Could not copy. Select the text instead.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text instead.");
    }
  }
  return (
    <ActionButton label={label} tooltip="Copy" onClick={() => void copy()}>
      <Copy data-admin-ux="backups-copy" aria-hidden="true" />
    </ActionButton>
  );
}
