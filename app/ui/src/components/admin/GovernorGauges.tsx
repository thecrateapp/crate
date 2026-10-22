import { useEffect } from "react";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

export interface GovernorGauge {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  limit: number;
  scale: number;
  over: boolean;
}

export interface GovernorSurface {
  available: boolean;
  stale: boolean;
  sampled_at?: string | null;
  sampled_by?: string | null;
  enabled?: boolean | null;
  allowed?: boolean | null;
  reason?: string;
  defer_seconds?: number;
  gauges: GovernorGauge[];
  window?: {
    enabled?: boolean;
    start?: string;
    end?: string;
    in_window?: boolean;
  } | null;
}

const REFRESH_INTERVAL_MS = 15_000;

function formatValue(value: number | null, unit: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${formatted}${unit}`;
}

function formatLimit(value: number, unit: string) {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${formatted}${unit}`;
}

function formatSampleTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function Gauge({ gauge }: { gauge: GovernorGauge }) {
  const scale = Math.max(gauge.scale, gauge.limit, 0.01);
  const fillPercent =
    gauge.value == null
      ? 0
      : Math.min(100, Math.max(0, (gauge.value / scale) * 100));
  const limitPercent = Math.min(100, Math.max(0, (gauge.limit / scale) * 100));
  const accessibleValue =
    gauge.value == null
      ? `${gauge.label}: unavailable`
      : `${gauge.label}: ${formatValue(gauge.value, gauge.unit)}, limit ${formatLimit(gauge.limit, gauge.unit)}`;

  return (
    <div
      role="meter"
      aria-label={accessibleValue}
      aria-valuemin={0}
      aria-valuemax={scale}
      aria-valuenow={gauge.value ?? undefined}
      className="min-w-0"
    >
      <MonoLabel as="div" size="eyebrow" className="truncate">
        {gauge.label}
      </MonoLabel>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm tabular-nums text-text-primary">
          {formatValue(gauge.value, gauge.unit)}
        </span>
        <span className="whitespace-nowrap font-mono text-[9px] tabular-nums text-text-subtle">
          MAX {formatLimit(gauge.limit, gauge.unit)}
        </span>
      </div>
      <div className="relative mt-2 h-px bg-border-quiet" aria-hidden="true">
        <span
          className={cn(
            "absolute inset-y-0 left-0",
            gauge.over ? "bg-state-warning-text" : "bg-accent-action-hi",
          )}
          style={{ width: `${fillPercent}%` }}
        />
        <span
          className="absolute -top-1 h-[9px] w-px bg-text-primary/80"
          style={{ left: `${limitPercent}%` }}
        />
      </div>
    </div>
  );
}

export function GovernorGauges({
  surface,
  loading = false,
  error = null,
}: {
  surface: GovernorSurface | null;
  loading?: boolean;
  error?: string | null;
}) {
  const sampleTime = formatSampleTime(surface?.sampled_at);
  const statusTone = error
    ? "warning"
    : surface?.enabled === false || surface?.allowed === false
      ? "warning"
      : surface?.allowed
        ? "accent"
        : "muted";
  const statusText = error
    ? surface?.available
      ? "RETRYING · USING LAST SAMPLE"
      : "RETRYING FOR WORKER SAMPLE"
    : surface?.enabled === false
      ? "ENFORCEMENT OFF"
      : surface?.allowed === false
        ? "DEFERRING GOVERNED WORK"
        : surface?.allowed
          ? "ALLOWED · BACKGROUND WORK RUNS"
          : "WAITING FOR WORKER SAMPLE";
  const deferral =
    surface?.allowed === false && surface.defer_seconds
      ? ` · RETRY IN ${Math.ceil(surface.defer_seconds / 60)}M`
      : "";

  return (
    <section
      role="region"
      aria-label="Resource governor"
      className="m-0 min-w-0 border-t border-border-quiet pt-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <MonoLabel as="h3" tone="accent" size="eyebrow">
            Resource governor
          </MonoLabel>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-subtle">
            {surface?.sampled_by || "Worker sample"}
            {sampleTime ? ` · ${sampleTime}` : ""}
          </span>
        </div>
        <span
          className={cn(
            "font-mono text-[9px] uppercase tracking-[0.12em]",
            statusTone === "warning"
              ? "text-state-warning-text"
              : statusTone === "accent"
                ? "text-accent-action-hi"
                : "text-text-subtle",
          )}
          role="status"
          aria-live="polite"
        >
          {statusText}
          {deferral}
          {surface?.stale ? " · STALE" : ""}
        </span>
      </header>

      {surface?.available && surface.gauges.length > 0 ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
            {surface.gauges.map((gauge) => (
              <Gauge key={gauge.id} gauge={gauge} />
            ))}
          </div>
          {surface.reason ? (
            <p className="mb-0 mt-3 font-mono text-[10px] text-state-warning-text">
              {surface.reason}
            </p>
          ) : surface.window?.enabled ? (
            <p className="mb-0 mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-text-subtle">
              Maintenance {surface.window.start}–{surface.window.end} ·{" "}
              {surface.window.in_window ? "inside window" : "outside window"}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mb-0 mt-3 text-sm leading-relaxed text-text-muted">
          {loading
            ? "Waiting for the first worker sample…"
            : surface?.available
              ? surface.reason || "Governor sample is unavailable."
              : "No worker sample is available yet."}
        </p>
      )}
    </section>
  );
}

export function ResourceGovernorMonitor() {
  const { data, loading, error, refetch } = useApi<GovernorSurface>(
    "/api/admin/governor",
  );

  useEffect(() => {
    const timer = window.setInterval(refetch, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refetch]);

  return <GovernorGauges surface={data} loading={loading} error={error} />;
}
