import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { Button } from "@crate/ui/shadcn/button";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import { Loader2, RefreshCw as HeaderRefreshCw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { ResponsiveLine } from "@nivo/line";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";

import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsStatTile,
  OpsSurface,
} from "@/components/admin/ops-surfaces";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Meter } from "@crate/ui/primitives/Meter";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";

import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { useApi } from "@/hooks/use-api";
import { taskLabel, useTaskCatalog } from "@/lib/task-catalog";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Link } from "react-router";

interface MetricSummary {
  count: number;
  avg: number;
  min: number;
  max: number;
  sum: number;
}

interface MetricsSummaryResponse {
  api_latency: MetricSummary;
  api_requests: MetricSummary;
  api_errors: MetricSummary;
  api_slow: MetricSummary;
  stream_requests: MetricSummary;
  stream_latency: MetricSummary;
  stream_concurrent: MetricSummary;
  stream_transcode_duration: MetricSummary;
  stream_transcode_completed: MetricSummary;
  stream_transcode_failed: MetricSummary;
  home_cache_hit: MetricSummary;
  home_cache_miss: MetricSummary;
  home_cache_waited: MetricSummary;
  home_cache_coalesced: MetricSummary;
  home_cache_stale_fallback: MetricSummary;
  home_compute_ms: MetricSummary;
  home_endpoint_cache_hit: MetricSummary;
  home_endpoint_cache_miss: MetricSummary;
  home_endpoint_compute_ms: MetricSummary;
  worker_resource_deferred: MetricSummary;
  worker_resource_defer_seconds: MetricSummary;
  worker_resource_load_ratio: MetricSummary;
  worker_resource_iowait_percent: MetricSummary;
  worker_resource_swap_used_percent: MetricSummary;
  media_worker_completed?: MetricSummary;
  media_worker_failed?: MetricSummary;
  media_worker_duration?: MetricSummary;
  media_worker_bytes?: MetricSummary;
  media_worker_admission_denied?: MetricSummary;
  media_worker_cache_pruned?: MetricSummary;
  media_worker_cache_bytes_removed?: MetricSummary;
}

interface TimeseriesPoint {
  timestamp: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  sum: number;
}

interface SystemHealthDashboardResponse {
  summary: MetricsSummaryResponse;
  system: SystemMetrics;
  tasks: ActiveTask[];
  playback_delivery?: PlaybackDeliverySnapshot;
  route_latency?: RouteLatencyRow[];
  timeseries: Record<string, TimeseriesPoint[]>;
}

interface ActiveTask {
  id: string;
  type: string;
  status: string;
  label?: string;
  progress?: string;
  created_at?: string;
  updated_at?: string;
}

interface DiskUsage {
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent: number;
}

interface DbPoolState {
  size: number;
  checked_in: number;
  checked_out: number;
  overflow: number;
  total: number;
  minconn?: number;
  maxconn?: number;
}

interface SystemMetrics {
  disk: Record<string, DiskUsage | null>;
  db_pool: DbPoolState;
  db_pools?: {
    combined?: DbPoolState;
    sqlalchemy?: DbPoolState;
    legacy?: DbPoolState;
  };
  analysis: {
    analysis?: { pending: number; done: number; failed: number };
    bliss?: { pending: number; done: number; failed: number };
  };
  load: {
    load_1m: number;
    load_5m: number;
    load_15m: number;
    cpu_count: number;
    load_percent: number;
  };
  resource_pressure?: ResourcePressure;
  media_worker?: MediaWorkerRuntime;
}

interface MediaWorkerRuntime {
  redis_connected: boolean;
  stream_key: string;
  consumer_group: string;
  stream_length: number;
  pending: number;
  max_active: number;
  active_slots: Array<{
    slot: number;
    key: string;
    job_id: string;
    ttl_ms: number;
  }>;
  recent_events?: Array<{
    id: string;
    job_id?: string | null;
    event?: string | null;
    status?: string | null;
    kind?: string | null;
    updated_at_ms?: number | string | null;
  }>;
}

interface ResourceSnapshot {
  cpu_count: number;
  load_1m?: number | null;
  load_ratio?: number | null;
  iowait_percent?: number | null;
  swap_used_percent?: number | null;
  active_users?: number | null;
  active_streams?: number | null;
}

interface ResourcePressure {
  allowed: boolean;
  reason?: string;
  defer_seconds?: number;
  snapshot?: ResourceSnapshot | null;
  window?: {
    enabled?: boolean;
    start?: string;
    end?: string;
    now?: string;
    in_window?: boolean;
    seconds_until_start?: number;
  } | null;
  last_defer?: ResourcePressure | null;
}

type Period = "minute" | "hour";

interface PlaybackDeliveryStats {
  tracks: number;
  lossless_tracks: number;
  hires_tracks: number;
  variants: number;
  variant_tracks: number;
  ready: number;
  pending: number;
  pending_active?: number;
  pending_unassigned?: number;
  pending_stale?: number;
  running: number;
  failed: number;
  missing: number;
  ready_tracks: number;
  cached_bytes: number;
  ready_source_bytes: number;
  estimated_saved_bytes: number;
  coverage_percent: number;
  avg_prepare_seconds: number | null;
}

interface PlaybackTranscodeRuntime {
  active: number;
  limit: number;
}

interface PlaybackVariant {
  id: string;
  status: string;
  preset: string;
  delivery_format: string;
  delivery_bitrate: number;
  bytes: number | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  updated_at?: string | null;
}

interface PlaybackDeliverySnapshot {
  stats: PlaybackDeliveryStats;
  runtime: PlaybackTranscodeRuntime;
  recent_variants: PlaybackVariant[];
}

interface RouteLatencyRow {
  route_id: string;
  target: string;
  method: string;
  path: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
  p99: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
  status_other: number;
  error_rate: number;
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${
    units[unitIndex]
  }`;
}

function formatMs(value: number | null | undefined) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${ms >= 100 ? ms.toFixed(0) : ms.toFixed(1)}ms`;
}

function formatRouteErrorRate(value: number | null | undefined) {
  const pct = Number(value || 0) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

function ChartTooltip({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string }[];
}) {
  return (
    <OpsSurface className="min-w-[180px] rounded-sm bg-panel-surface px-3 py-3 text-xs text-text-primary">
      <MonoLabel as="div" tone="accent">
        Metric slice
      </MonoLabel>
      <div className="mt-2 font-medium text-text-primary">{title}</div>
      <div className="mt-3 space-y-1.5">
        {items.map((item) => (
          <div
            key={`${item.label}-${item.value}`}
            className="flex items-center justify-between gap-4 border-b border-border-quiet pb-1 last:border-b-0 last:pb-0"
          >
            <span className="text-text-muted">{item.label}</span>
            <span className="font-medium text-text-primary">{item.value}</span>
          </div>
        ))}
      </div>
    </OpsSurface>
  );
}

function HealthSignal({
  score,
  summary,
}: {
  score: number | null;
  summary: string;
}) {
  const color =
    score == null
      ? "text-text-subtle"
      : score >= 80
        ? "text-accent-action-hi"
        : "text-state-warning-text";
  const bg =
    score == null
      ? "border-border-quiet bg-raised-surface"
      : score >= 80
        ? "border-accent-action/25 bg-accent-action/[0.08]"
        : "border-state-warning/25 bg-state-warning/[0.08]";

  return (
    <OpsSurface className={`px-5 py-4 ${bg}`}>
      <div className="crate-form-field">
        <MonoLabel as="div">Health Score</MonoLabel>
        <div className={`font-mono text-3xl font-normal tabular-nums ${color}`}>
          {score ?? "—"}
        </div>
      </div>
      <div className="mt-3 text-xs text-text-muted">{summary}</div>
    </OpsSurface>
  );
}

function ResourceCard({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <OpsSurface className="p-4">
      <div className="crate-form-field">
        <MonoLabel as="div">{label}</MonoLabel>
        <div className="font-mono text-xl font-normal text-text-primary tabular-nums break-words">
          {value}
        </div>
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </OpsSurface>
  );
}

function ResourceMeter({
  value,
  max,
  color,
  label = "Usage",
  valueText,
}: {
  value: number | null;
  max: number;
  color?: string;
  label?: string;
  valueText?: string;
}) {
  const pct = value != null && max > 0 ? (value / max) * 100 : null;
  return (
    <div className="space-y-2">
      <Meter
        value={value}
        max={max}
        label={label}
        valueText={
          valueText ?? (pct == null ? "Unavailable" : `${pct.toFixed(0)}%`)
        }
        over={value != null && max > 0 && value > max}
      />
      {value != null && value <= max && color === "bg-state-warning" ? (
        <InfoBadge tone="warning">Elevated</InfoBadge>
      ) : null}
    </div>
  );
}

function MetricChart({
  title,
  data,
  yLabel,
  series,
}: {
  title: string;
  data: TimeseriesPoint[];
  yLabel: string;
  series?: { id: string; field: keyof TimeseriesPoint }[];
}) {
  const motionAllowed = useMotionAllowed();
  const { chartData, tickValues } = useMemo(() => {
    if (!data?.length) return { chartData: [], tickValues: [] as string[] };
    const labels = data.map((point) =>
      new Date(point.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    const maxTicks = 6;
    const step = Math.max(1, Math.floor(labels.length / maxTicks));
    const picks: string[] = [];
    for (let i = 0; i < labels.length; i += step) {
      const label = labels[i];
      if (label) picks.push(label);
    }

    const lines = series ?? [
      { id: "avg", field: "avg" as const },
      { id: "max", field: "max" as const },
    ];

    return {
      chartData: lines.map((line) => ({
        id: line.id,
        data: data.map((point, index) => ({
          x: labels[index] ?? "",
          y: (point[line.field] as number) ?? 0,
        })),
      })),
      tickValues: picks,
    };
  }, [data, series]);

  if (!chartData.length) {
    return (
      <OpsSurface className="p-4">
        <div className="mb-2 font-display text-xl font-bold text-text-primary">
          {title}
        </div>
        <EmptyState
          message="No data yet"
          className="h-48 items-center text-center"
        />
      </OpsSurface>
    );
  }

  return (
    <OpsSurface className="p-4">
      <div className="mb-2 font-display text-xl font-bold text-text-primary">
        {title}
      </div>
      <div className="h-48">
        <ResponsiveLine
          animate={motionAllowed}
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 32, left: 48 }}
          xScale={{ type: "point" }}
          yScale={{ type: "linear", min: 0, max: "auto" }}
          curve="monotoneX"
          colors={[
            "var(--color-accent-action-hi)",
            "color-mix(in srgb, var(--color-accent-action-hi) 30%, transparent)",
            "var(--color-state-warning)",
            "color-mix(in srgb, var(--color-state-warning) 30%, transparent)",
          ]}
          lineWidth={2}
          pointSize={0}
          enableArea={true}
          areaOpacity={0.08}
          enableGridX={false}
          gridYValues={4}
          theme={{
            text: { fill: "var(--color-text-subtle)", fontSize: 10 },
            grid: { line: { stroke: "var(--color-border-quiet)" } },
            crosshair: {
              line: {
                stroke: "var(--color-accent-action-hi)",
                strokeWidth: 1,
              },
            },
            tooltip: {
              container: {
                background: "transparent",
                border: "none",
                boxShadow: "none",
                padding: 0,
              },
            },
          }}
          axisBottom={{ tickSize: 0, tickPadding: 8, tickValues }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
            tickValues: 4,
            legend: yLabel,
            legendPosition: "middle",
            legendOffset: -40,
          }}
          enableSlices="x"
          sliceTooltip={({ slice }) => (
            <ChartTooltip
              title={String(slice.points[0]?.data.x ?? "")}
              items={slice.points.map((point) => ({
                label: String(point.seriesId),
                value:
                  typeof point.data.y === "number"
                    ? (point.data.y as number).toFixed(1)
                    : String(point.data.y ?? "0"),
              }))}
            />
          )}
        />
      </div>
    </OpsSurface>
  );
}

function RouteLatencyOverview({ routes }: { routes: RouteLatencyRow[] }) {
  const visibleRoutes = routes.slice(0, 8);
  const maxP95 = Math.max(1, ...visibleRoutes.map((route) => route.p95 || 0));
  const totalRequests = routes.reduce(
    (acc, route) => acc + (route.count || 0),
    0,
  );
  const slowest = visibleRoutes[0];
  const highestP99 = visibleRoutes.reduce<RouteLatencyRow | null>(
    (current, route) => (!current || route.p99 > current.p99 ? route : current),
    null,
  );
  const failing = routes.reduce(
    (acc, route) => acc + (route.status_5xx || 0),
    0,
  );

  return (
    <OpsPanel
      title="API Route Latency"
      description="Recent endpoint latency ranked by p95, useful for finding the routes hurting admin and Listen first."
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OpsStatTile
            label="Measured Routes"
            value={routes.length.toLocaleString()}
            caption={`${totalRequests.toLocaleString()} sampled requests`}
            tone={routes.length > 0 ? "primary" : "default"}
          />
          <OpsStatTile
            label="Slowest p95"
            value={formatMs(slowest?.p95)}
            caption={
              slowest
                ? `${slowest.method} ${slowest.path}`
                : "Waiting for route samples"
            }
            tone={slowest && slowest.p95 > 1000 ? "warning" : "default"}
          />
          <OpsStatTile
            label="Highest p99"
            value={formatMs(highestP99?.p99)}
            caption={
              highestP99
                ? `${highestP99.method} ${highestP99.path}`
                : "Waiting for route samples"
            }
            tone={highestP99 && highestP99.p99 > 3000 ? "warning" : "default"}
          />
          <OpsStatTile
            label="Route 5xx"
            value={failing.toLocaleString()}
            caption="Server errors in the sampled window"
            tone={failing > 0 ? "danger" : "default"}
          />
        </div>

        <OpsSurface className="overflow-hidden">
          {visibleRoutes.length > 0 ? (
            <div className="divide-y divide-border-quiet">
              {visibleRoutes.map((route) => {
                const isSlow = route.p95 >= 1000;
                const isVerySlow = route.p95 >= 3000 || route.error_rate > 0.01;
                const barColor = isVerySlow
                  ? "bg-state-warning"
                  : isSlow
                    ? "bg-state-warning"
                    : "bg-accent-action";

                return (
                  <div
                    key={route.route_id}
                    className="grid grid-cols-2 gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_6rem] xl:items-center"
                  >
                    <div className="col-span-2 min-w-0 xl:col-span-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <InfoBadge className="shrink-0">
                          {route.method}
                        </InfoBadge>
                        <span className="min-w-0 truncate font-mono text-sm text-text-primary">
                          {route.path}
                        </span>
                      </div>
                      <div className="mt-2 max-w-xl">
                        <ResourceMeter
                          value={route.p95}
                          max={maxP95}
                          color={barColor}
                          label={`${route.method} ${route.path} p95`}
                          valueText={`${route.p95.toFixed(0)} ms; highest sampled route p95 ${maxP95.toFixed(0)} ms`}
                        />
                      </div>
                    </div>
                    <div className="crate-form-field">
                      <MonoLabel as="span" data-slot="form-field-label">
                        Count
                      </MonoLabel>
                      <span className="text-sm font-medium tabular-nums text-text-primary">
                        {route.count.toLocaleString()}
                      </span>
                    </div>
                    <div className="crate-form-field">
                      <MonoLabel as="span" data-slot="form-field-label">
                        Avg
                      </MonoLabel>
                      <span className="text-sm font-medium tabular-nums text-text-primary">
                        {formatMs(route.avg)}
                      </span>
                    </div>
                    <div className="crate-form-field">
                      <MonoLabel as="span" data-slot="form-field-label">
                        p95 / p99
                      </MonoLabel>
                      <span
                        className={`text-sm font-medium tabular-nums ${
                          isVerySlow
                            ? "text-state-warning-text"
                            : isSlow
                              ? "text-state-warning-text"
                              : "text-text-primary"
                        }`}
                      >
                        {formatMs(route.p95)} · {formatMs(route.p99)}
                      </span>
                    </div>
                    <div className="crate-form-field">
                      <MonoLabel as="span" data-slot="form-field-label">
                        5xx
                      </MonoLabel>
                      <span
                        className={`text-sm font-medium tabular-nums ${
                          route.error_rate > 0
                            ? "text-state-warning-text"
                            : "text-text-secondary"
                        }`}
                      >
                        {formatRouteErrorRate(route.error_rate)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              message="No route latency samples yet"
              className="min-h-[132px] items-center text-center"
            />
          )}
        </OpsSurface>
      </div>
    </OpsPanel>
  );
}

export function SystemHealth() {
  useTaskCatalog();
  const [period, setPeriod] = useState<Period>("minute");
  const minutes = period === "minute" ? 60 : 1440;

  const {
    data: dashboard,
    loading,
    error,
    refetch: refetchDashboard,
  } = useApi<SystemHealthDashboardResponse>(
    `/api/admin/metrics/dashboard?period=${period}&minutes=${minutes}`,
  );

  const summary = dashboard?.summary ?? null;
  const system = dashboard?.system ?? null;
  const tasks = dashboard?.tasks ?? [];
  const latencyTs = dashboard?.timeseries?.["api.latency"] ?? [];
  const requestsTs = dashboard?.timeseries?.["api.requests"] ?? [];
  const errorsTs = dashboard?.timeseries?.["api.errors"] ?? [];
  const apiSlowTs = dashboard?.timeseries?.["api.slow"] ?? [];
  const streamTs = dashboard?.timeseries?.["stream.requests"] ?? [];
  const transcodeDurationTs =
    dashboard?.timeseries?.["stream.transcode.duration"] ?? [];
  const homeComputeTs = dashboard?.timeseries?.["home.compute.ms"] ?? [];
  const homeEndpointComputeTs =
    dashboard?.timeseries?.["home.endpoint_compute.ms"] ?? [];
  const queueTs = dashboard?.timeseries?.["worker.queue.depth"] ?? [];
  const taskDurationTs = dashboard?.timeseries?.["worker.task.duration"] ?? [];
  const queueWaitTs = dashboard?.timeseries?.["worker.queue.wait"] ?? [];
  const resourceDeferredTs =
    dashboard?.timeseries?.["worker.resource.deferred"] ?? [];
  const resourceLoadTs =
    dashboard?.timeseries?.["worker.resource.load_ratio"] ?? [];
  const playbackDelivery = dashboard?.playback_delivery;
  const routeLatency = dashboard?.route_latency ?? [];

  const score = useMemo(() => {
    if (!summary) return null;
    let next = 100;
    if (summary.api_latency.max > 3000) next -= 15;
    if (summary.api_errors.count > 0 && summary.api_requests.count > 0) {
      const errRate = summary.api_errors.count / summary.api_requests.count;
      if (errRate > 0.05) next -= 20;
      else if (errRate > 0.01) next -= 5;
    }
    if (system?.load?.load_percent && system.load.load_percent > 80) next -= 10;
    if (
      system?.db_pool?.checked_out &&
      system.db_pool.checked_out >= (system.db_pool.size || 8)
    )
      next -= 10;
    if (system?.resource_pressure && !system.resource_pressure.allowed)
      next -= 10;
    return Math.max(0, next);
  }, [summary, system]);

  const errorRate =
    summary && summary.api_requests.count > 0
      ? ((summary.api_errors.count / summary.api_requests.count) * 100).toFixed(
          2,
        )
      : "—";
  const homeCacheTotal =
    (summary?.home_cache_hit.count ?? 0) +
    (summary?.home_cache_miss.count ?? 0);
  const homeCacheHitRate =
    homeCacheTotal > 0
      ? ((summary?.home_cache_hit.count ?? 0) / homeCacheTotal) * 100
      : 0;
  const homeEndpointCacheTotal =
    (summary?.home_endpoint_cache_hit.count ?? 0) +
    (summary?.home_endpoint_cache_miss.count ?? 0);
  const homeEndpointCacheHitRate =
    homeEndpointCacheTotal > 0
      ? ((summary?.home_endpoint_cache_hit.count ?? 0) /
          homeEndpointCacheTotal) *
        100
      : 0;

  const scoreSummary =
    score == null
      ? "Health score unavailable: no metrics summary was returned."
      : score >= 80
        ? "Core services look stable and current pressure is within healthy bounds."
        : score >= 50
          ? "The system is usable, but latency or load deserve attention before they become user-facing."
          : "Health is degraded enough to warrant immediate triage on latency, queue pressure or database usage.";

  const runningTasks = tasks.length;
  const queueDepth = queueTs.length
    ? (queueTs[queueTs.length - 1]?.max ?? 0)
    : null;

  if (loading && !dashboard) {
    return (
      <div
        role="status"
        aria-label="Loading system health metrics"
        aria-busy="true"
        className="flex justify-center py-16 text-text-muted"
      >
        <Loader2
          data-admin-ux="system-health-loading"
          aria-hidden="true"
          className="h-5 w-5 animate-spin text-accent-action-hi"
        />
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <ErrorState
        message="Could not load system health metrics."
        onRetry={refetchDashboard}
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && dashboard ? (
        <OpsRefreshNotice
          message="Could not refresh system health metrics. Showing the last successful sample."
          onRetry={refetchDashboard}
        />
      ) : null}
      <OpsPageHero
        title="System Health"
        description="Runtime pressure, API performance, queue behavior and infrastructure saturation across the stack."
        compactActions
        actions={
          <PageHeaderActions>
            <SegmentedControl
              as="radio"
              label="Metrics window"
              value={period}
              onValueChange={setPeriod}
              items={[
                { value: "minute", label: "1h" },
                { value: "hour", label: "24h" },
              ]}
            />
            <PageHeaderAction
              label="Refresh metrics"
              onClick={() => refetchDashboard()}
            >
              <HeaderRefreshCw
                data-admin-ux="header-refresh-metrics"
                aria-hidden="true"
              />
            </PageHeaderAction>
          </PageHeaderActions>
        }
      >
        <InfoBadge>
          {summary
            ? `${summary.api_requests.count} requests`
            : "Metrics loading"}
        </InfoBadge>
        <InfoBadge>{runningTasks} running tasks</InfoBadge>
        <InfoBadge>{queueDepth ?? "—"} queued depth</InfoBadge>
        {summary && errorRate !== "—" ? (
          <InfoBadge
            className={
              Number(errorRate) > 1
                ? "border-state-warning/25 bg-state-warning/10 text-state-warning-text"
                : undefined
            }
          >
            {errorRate}% error rate
          </InfoBadge>
        ) : null}
        {summary && homeCacheTotal > 0 ? (
          <InfoBadge>{homeCacheHitRate.toFixed(0)}% home core hit</InfoBadge>
        ) : null}
        {summary && homeEndpointCacheTotal > 0 ? (
          <InfoBadge>
            {homeEndpointCacheHitRate.toFixed(0)}% home endpoint hit
          </InfoBadge>
        ) : null}
        {summary?.worker_resource_deferred?.count ? (
          <InfoBadge>
            {summary.worker_resource_deferred.count} batch deferrals
          </InfoBadge>
        ) : null}
        {system?.resource_pressure ? (
          <InfoBadge
            className={
              system.resource_pressure.allowed
                ? "border-accent-action/25 bg-accent-action/10 text-accent-action-hi"
                : "border-state-warning/25 bg-state-warning/10 text-state-warning-text"
            }
          >
            {system.resource_pressure.allowed ? "Batch open" : "Batch deferred"}
          </InfoBadge>
        ) : null}
      </OpsPageHero>

      <div
        data-slot="system-health-summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4"
      >
        <HealthSignal score={score} summary={scoreSummary} />
        <OpsStatTile
          label="API max"
          value={
            <span className="whitespace-nowrap">
              {summary ? `${summary.api_latency.max.toFixed(0)}ms` : "—"}
            </span>
          }
          caption={
            summary
              ? `avg ${summary.api_latency.avg.toFixed(0)}ms`
              : "Waiting for metrics"
          }
          tone={
            summary && summary.api_latency.max > 3000 ? "warning" : "default"
          }
        />
        <OpsStatTile
          label="Error Rate"
          value={errorRate === "—" ? "—" : `${errorRate}%`}
          caption={
            summary
              ? `${summary.api_errors.count} / ${summary.api_requests.count} requests`
              : "Waiting for metrics"
          }
          tone={Number(errorRate) > 1 ? "danger" : "default"}
        />
        <OpsStatTile
          label="Slow Requests"
          value={summary ? `${summary.api_slow.count}` : "—"}
          caption={
            summary
              ? `${summary.api_slow.count} requests over 1s in the current window`
              : "Waiting for metrics"
          }
          tone={summary && summary.api_slow.count > 0 ? "warning" : "default"}
        />
        <OpsStatTile
          label="Home Core Cache"
          value={homeCacheTotal > 0 ? `${homeCacheHitRate.toFixed(0)}%` : "—"}
          caption={
            summary
              ? `${summary.home_cache_hit.count} hits, ${summary.home_cache_miss.count} misses`
              : "Waiting for metrics"
          }
          tone="default"
        />
        <OpsStatTile
          label="Home Endpoint Cache"
          value={
            homeEndpointCacheTotal > 0
              ? `${homeEndpointCacheHitRate.toFixed(0)}%`
              : "—"
          }
          caption={
            summary
              ? `${summary.home_endpoint_cache_hit.count} hits, ${summary.home_endpoint_cache_miss.count} misses`
              : "Waiting for metrics"
          }
          tone="default"
        />
        <OpsStatTile
          label="Load"
          value={system?.load ? `${system.load.load_1m}` : "—"}
          caption={
            system?.load
              ? `${system.load.load_percent}% of ${system.load.cpu_count} cores`
              : "Waiting for system metrics"
          }
          tone={
            system?.load && system.load.load_percent > 80
              ? "warning"
              : "default"
          }
        />
      </div>

      <RouteLatencyOverview routes={routeLatency} />

      <OpsPanel
        title="Playback delivery"
        description="A concise view of cached audio readiness. Open the dedicated page for variants and worker capacity."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/playback">Open playback delivery</Link>
          </Button>
        }
      >
        {playbackDelivery?.stats && playbackDelivery.runtime ? (
          <div className="flex flex-wrap gap-2">
            <InfoBadge>
              {playbackDelivery.stats.coverage_percent}% lossless coverage
            </InfoBadge>
            <InfoBadge>
              {playbackDelivery.stats.ready_tracks.toLocaleString()} tracks
              ready
            </InfoBadge>
            <InfoBadge>
              {playbackDelivery.runtime.active}/{playbackDelivery.runtime.limit}{" "}
              transcodes
            </InfoBadge>
          </div>
        ) : (
          <p className="m-0 text-sm text-text-muted">
            Playback delivery metrics are unavailable in this sample.
          </p>
        )}
      </OpsPanel>

      {system ? (
        <InstrumentPanel
          label={{ children: "Resources", tone: "accent" }}
          headingLevel={2}
          summary={
            system.disk?.music
              ? `Music volume uses ${system.disk.music.used_gb} of ${system.disk.music.total_gb} GB.`
              : undefined
          }
        >
          <p className="mb-5 text-sm text-muted-foreground">
            Storage pressure, database pool use and analysis backlog surfaced as
            operational cards.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {system.disk?.music ? (
              <ResourceCard
                label="Music Volume"
                value={`${system.disk.music.used_gb} / ${system.disk.music.total_gb} GB`}
              >
                <ResourceMeter
                  value={system.disk.music.used_gb}
                  max={system.disk.music.total_gb}
                  color={
                    system.disk.music.percent > 90
                      ? "bg-state-warning"
                      : system.disk.music.percent > 75
                        ? "bg-state-warning"
                        : "bg-accent-action-hi"
                  }
                  label={`${system.disk.music.free_gb} GB free`}
                />
              </ResourceCard>
            ) : null}

            {system.disk?.data ? (
              <ResourceCard
                label="Data Volume"
                value={`${system.disk.data.used_gb} / ${system.disk.data.total_gb} GB`}
              >
                <ResourceMeter
                  value={system.disk.data.used_gb}
                  max={system.disk.data.total_gb}
                  color={
                    system.disk.data.percent > 90
                      ? "bg-state-warning"
                      : system.disk.data.percent > 75
                        ? "bg-state-warning"
                        : "bg-accent-action-hi"
                  }
                  label={`${system.disk.data.free_gb} GB free`}
                />
              </ResourceCard>
            ) : null}

            {system.db_pool?.size > 0 ? (
              <ResourceCard
                label="DB Pools"
                value={`${system.db_pool.checked_out} / ${
                  system.db_pool.size +
                  (system.db_pool.overflow > 0 ? system.db_pool.overflow : 0)
                }`}
              >
                <ResourceMeter
                  value={system.db_pool.checked_out}
                  max={system.db_pool.size}
                  color={
                    system.db_pool.checked_out >= system.db_pool.size
                      ? "bg-state-warning"
                      : "bg-accent-action-hi"
                  }
                  label={`${system.db_pool.checked_in} idle, ${system.db_pool.checked_out} active`}
                />
                {system.db_pools?.sqlalchemy?.size ? (
                  <div className="font-mono text-label text-text-subtle">
                    SQLAlchemy: {system.db_pools.sqlalchemy.checked_out}/
                    {system.db_pools.sqlalchemy.size} checked out
                  </div>
                ) : null}
                {system.db_pools?.legacy?.size ? (
                  <div className="font-mono text-label text-text-subtle">
                    Legacy: {system.db_pools.legacy.checked_out}/
                    {system.db_pools.legacy.size} checked out
                  </div>
                ) : null}
              </ResourceCard>
            ) : null}

            {system.analysis?.analysis ? (
              <ResourceCard
                label="Analysis"
                value={`${system.analysis.analysis.done} / ${
                  system.analysis.analysis.done +
                  system.analysis.analysis.pending
                }`}
              >
                <ProgressHairline
                  label="Audio analysis coverage"
                  value={
                    system.analysis.analysis.done +
                      system.analysis.analysis.pending >
                    0
                      ? system.analysis.analysis.done /
                        (system.analysis.analysis.done +
                          system.analysis.analysis.pending)
                      : undefined
                  }
                  valueText={`${system.analysis.analysis.done} done, ${system.analysis.analysis.pending} pending, ${system.analysis.analysis.failed} failed`}
                />
                <MonoLabel as="p">
                  {system.analysis.analysis.pending} pending
                  {system.analysis.analysis.failed > 0
                    ? `, ${system.analysis.analysis.failed} failed`
                    : ""}
                </MonoLabel>
                {system.analysis.bliss && system.analysis.bliss.pending > 0 ? (
                  <div className="font-mono text-label text-text-subtle">
                    Bliss: {system.analysis.bliss.done} done,{" "}
                    {system.analysis.bliss.pending} pending
                  </div>
                ) : null}
              </ResourceCard>
            ) : null}

            {system.resource_pressure ? (
              <ResourceCard
                label="Resource Governor"
                value={system.resource_pressure.allowed ? "Open" : "Deferring"}
              >
                <ResourceMeter
                  value={
                    system.resource_pressure.snapshot?.load_ratio != null
                      ? system.resource_pressure.snapshot.load_ratio * 100
                      : null
                  }
                  max={100}
                  color={
                    system.resource_pressure.allowed
                      ? "bg-accent-action-hi"
                      : "bg-state-warning"
                  }
                  label={
                    system.resource_pressure.reason
                      ? system.resource_pressure.reason
                      : "No batch pressure detected"
                  }
                />
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-label text-text-muted">
                  <span>
                    IO wait:{" "}
                    {system.resource_pressure.snapshot?.iowait_percent ?? "—"}%
                  </span>
                  <span>
                    Swap:{" "}
                    {system.resource_pressure.snapshot?.swap_used_percent ??
                      "—"}
                    %
                  </span>
                  <span>
                    Listeners:{" "}
                    {system.resource_pressure.snapshot?.active_users ?? "—"}
                  </span>
                  <span>
                    Streams:{" "}
                    {system.resource_pressure.snapshot?.active_streams ?? "—"}
                  </span>
                </div>
                {system.resource_pressure.window?.enabled ? (
                  <div className="font-mono text-label text-text-subtle">
                    Window {system.resource_pressure.window.start}-
                    {system.resource_pressure.window.end}
                    {" · "}
                    {system.resource_pressure.window.in_window
                      ? "inside"
                      : "outside"}
                  </div>
                ) : null}
              </ResourceCard>
            ) : null}

            {system.media_worker ? (
              <ResourceCard
                label="Media Worker"
                value={
                  system.media_worker.redis_connected
                    ? `${system.media_worker.active_slots?.length ?? 0} / ${
                        system.media_worker.max_active ?? 1
                      } active`
                    : "Redis offline"
                }
              >
                <ResourceMeter
                  value={system.media_worker.active_slots?.length ?? 0}
                  max={Math.max(1, system.media_worker.max_active ?? 1)}
                  color={
                    system.media_worker.pending > 0
                      ? "bg-state-warning"
                      : "bg-accent-action-hi"
                  }
                  label={`${
                    system.media_worker.pending ?? 0
                  } pending bridge events`}
                />
                <div className="font-mono text-label text-text-subtle">
                  {system.media_worker.recent_events?.[0]?.event
                    ? `Latest: ${String(
                        system.media_worker.recent_events[0].event,
                      ).replace(/_/g, " ")}`
                    : system.media_worker.consumer_group}
                </div>
                {summary?.media_worker_completed ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-label text-text-muted">
                    <span>Done: {summary.media_worker_completed.count}</span>
                    <span>
                      Failed: {summary.media_worker_failed?.count ?? 0}
                    </span>
                    <span>
                      Denied:{" "}
                      {summary.media_worker_admission_denied?.count ?? 0}
                    </span>
                    <span>
                      Pruned:{" "}
                      {formatBytes(
                        summary.media_worker_cache_bytes_removed?.sum ?? 0,
                      )}
                    </span>
                  </div>
                ) : null}
              </ResourceCard>
            ) : null}
          </div>
        </InstrumentPanel>
      ) : null}

      <OpsPanel
        title="Metric Streams"
        description="Latency, request volume, queue pressure and task execution trends over the selected time window."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricChart title="API Latency" data={latencyTs} yLabel="ms" />
          <MetricChart title="Request Volume" data={requestsTs} yLabel="req" />
          <MetricChart
            title="Error Rate"
            data={errorsTs}
            yLabel="errors"
            series={[{ id: "errors", field: "count" }]}
          />
          <MetricChart
            title="Slow Requests"
            data={apiSlowTs}
            yLabel="slow"
            series={[{ id: "slow", field: "count" }]}
          />
          <MetricChart
            title="Stream Activity"
            data={streamTs}
            yLabel="streams"
          />
          <MetricChart
            title="Transcode Duration"
            data={transcodeDurationTs}
            yLabel="sec"
          />
          <MetricChart
            title="Home Core Compute"
            data={homeComputeTs}
            yLabel="ms"
          />
          <MetricChart
            title="Home Endpoint Compute"
            data={homeEndpointComputeTs}
            yLabel="ms"
          />
          <MetricChart
            title="Task Duration"
            data={taskDurationTs}
            yLabel="sec"
          />
          <MetricChart
            title="Queue Wait Time"
            data={queueWaitTs}
            yLabel="sec"
          />
          <MetricChart title="Queue Depth" data={queueTs} yLabel="tasks" />
          <MetricChart
            title="Resource Deferrals"
            data={resourceDeferredTs}
            yLabel="deferrals"
            series={[{ id: "deferred", field: "count" }]}
          />
          <MetricChart
            title="Resource Load Ratio"
            data={resourceLoadTs}
            yLabel="ratio"
          />
        </div>
      </OpsPanel>

      {tasks.length > 0 ? (
        <OpsPanel
          title="Running Tasks"
          description="The worker jobs currently in flight, with elapsed time and live progress where available."
        >
          <div className="space-y-2">
            {tasks.map((task) => {
              let progress: Record<string, unknown> | null = null;
              try {
                progress =
                  typeof task.progress === "string"
                    ? JSON.parse(task.progress)
                    : task.progress
                      ? (task.progress as Record<string, unknown>)
                      : null;
              } catch {
                progress = null;
              }
              const pct =
                Number(progress?.percent ?? 0) ||
                (progress?.done && progress?.total
                  ? (Number(progress.done) / Number(progress.total)) * 100
                  : 0);
              const elapsed = task.created_at
                ? Math.round(
                    (Date.now() - new Date(task.created_at).getTime()) / 1000,
                  )
                : 0;
              const elapsedStr =
                elapsed > 3600
                  ? `${Math.floor(elapsed / 3600)}h ${Math.floor(
                      (elapsed % 3600) / 60,
                    )}m`
                  : elapsed > 60
                    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                    : `${elapsed}s`;

              return (
                <OpsSurface
                  as="div"
                  key={task.id}
                  className="grid grid-cols-2 items-center gap-3 px-4 py-3 sm:flex"
                >
                  <div className="col-span-2 min-w-0 flex-1">
                    <div className="break-words text-sm font-medium text-text-primary">
                      {task.label || taskLabel(task.type)}
                    </div>
                    <div className="mt-0.5 break-words text-xs text-text-muted">
                      {progress?.phase ? (
                        <span>{String(progress.phase)}</span>
                      ) : null}
                      {progress?.item ? (
                        <span> — {String(progress.item)}</span>
                      ) : null}
                    </div>
                  </div>
                  {pct > 0 ? (
                    <div className="flex min-w-0 items-center gap-2 sm:w-32 sm:shrink-0">
                      <div className="min-w-0 flex-1">
                        <ProgressHairline
                          label={`${task.label || taskLabel(task.type)} progress`}
                          value={pct / 100}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-label tabular-nums text-text-muted">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-self-end gap-1 font-mono text-label font-normal text-text-subtle">
                    Elapsed
                    <span className="tabular-nums">{elapsedStr}</span>
                  </div>
                  <span className="font-mono text-label text-text-subtle">
                    {task.id.slice(0, 8)}
                  </span>
                </OpsSurface>
              );
            })}
          </div>
        </OpsPanel>
      ) : null}
    </div>
  );
}
