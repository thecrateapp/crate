import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  RefreshCw as HeaderRefreshCw,
  Loader2,
  Pause,
  Play,
} from "lucide-react";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { SeverityMeter } from "@/components/admin/status-indicators";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsSnapshotStatus,
  OpsStatTile,
  type OpsStreamStatus,
} from "@/components/admin/ops-surfaces";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

interface LogEntry {
  id: number;
  worker_id: string;
  task_id: string | null;
  level: string;
  category: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface WorkerInfo {
  worker_id: string;
  last_seen: string;
  log_count: number;
}

interface LogsSnapshotData {
  snapshot: {
    scope: string;
    subject_key: string;
    version: number;
    built_at?: string | null;
    stale_after?: string | null;
    stale: boolean;
    generation_ms: number;
  };
  logs: LogEntry[];
  workers: WorkerInfo[];
}

const EMPTY_LOGS: LogEntry[] = [];
const EMPTY_WORKERS: WorkerInfo[] = [];

const KNOWN_CATEGORIES = [
  "general",
  "enrichment",
  "analysis",
  "tidal",
  "sync",
  "system",
];

function formatLogTimestamp(ts: string) {
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return ts;
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function isWorkerOnline(lastSeen: string) {
  const ts = new Date(lastSeen).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= 5 * 60 * 1000;
}

function metadataPreview(metadata: Record<string, unknown> | null) {
  if (!metadata || Object.keys(metadata).length === 0) return "";
  return JSON.stringify(metadata);
}

function WorkerTile({
  worker,
  active,
  onClick,
}: {
  worker: WorkerInfo;
  active: boolean;
  onClick: () => void;
}) {
  const online = isWorkerOnline(worker.last_seen);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border bg-raised-surface p-3 text-left transition-colors",
        active
          ? "border-accent-action/25 bg-accent-action/10"
          : "border-border-quiet hover:bg-surface-control",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-text-primary">
            {worker.worker_id}
          </div>
          <div className="text-xs text-text-muted">
            {worker.log_count} log lines seen
          </div>
        </div>
        <StatusDot
          tone={online ? "on" : "off"}
          label={online ? "Online" : "Idle"}
        />
      </div>
      <div className="mt-3 text-xs text-text-subtle">
        Last seen {timeAgo(worker.last_seen)}
      </div>
    </button>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const level = entry.level.toLowerCase();
  const messageTone =
    level === "debug" ? "text-text-muted" : "text-text-secondary";
  const metadata = metadataPreview(entry.metadata);

  return (
    <div
      className={cn(
        "grid gap-3 border-b border-border-quiet px-4 py-3 font-mono text-label transition-colors md:grid-cols-[78px_68px_minmax(0,1fr)]",
      )}
    >
      <div className="text-text-subtle tabular-nums">
        {formatLogTimestamp(entry.created_at)}
      </div>
      <SeverityMeter level={level} label={level} />
      <div className="min-w-0 space-y-1">
        <div className={cn("break-words leading-5", messageTone)}>
          {entry.message}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-label text-text-muted">
          <InfoBadge>{entry.category}</InfoBadge>
          <InfoBadge>{entry.worker_id}</InfoBadge>
          {entry.task_id ? (
            <Link
              to={`/tasks?task=${entry.task_id}`}
              className="font-sans text-accent-action-hi hover:underline"
            >
              Task {entry.task_id.slice(0, 8)}
            </Link>
          ) : null}
          <span>{timeAgo(entry.created_at)}</span>
        </div>
        {metadata ? (
          <details className="min-w-0 text-label text-text-subtle">
            <summary className="flex min-h-11 cursor-pointer items-center">
              Inspect metadata
            </summary>
            <pre className="max-h-80 overflow-auto whitespace-pre rounded-md border border-border-quiet bg-panel-surface p-3 text-label text-text-secondary">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function Logs() {
  const [snapshot, setSnapshot] = useState<LogsSnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [streamStatus, setStreamStatus] =
    useState<OpsStreamStatus>("connecting");
  const loadedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);

  const fetchSnapshot = useCallback(async (fresh = false) => {
    if (!loadedRef.current) setLoading(true);
    try {
      const query = fresh ? "?limit=100&fresh=1" : "?limit=100";
      const data = await api<LogsSnapshotData>(
        `/api/admin/logs-snapshot${query}`,
      );
      setSnapshot(data);
      setError(null);
      loadedRef.current = true;
    } catch {
      setError("Failed to load worker logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!autoRefresh) {
      setStreamStatus("paused");
      return;
    }
    setStreamStatus("connecting");
    let disposed = false;
    let stream: EventSource | null = null;

    function connect() {
      if (disposed) return;
      stream = new EventSource("/api/admin/logs-stream?limit=100", {
        withCredentials: true,
      });
      stream.onopen = () => setStreamStatus("live");
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as LogsSnapshotData;
          setSnapshot(payload);
          setError(null);
          setStreamStatus("live");
          setLoading(false);
          loadedRef.current = true;
        } catch {
          // Ignore malformed snapshots.
        }
      };
      stream.onerror = () => {
        stream?.close();
        stream = null;
        setStreamStatus("reconnecting");
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 5000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      stream?.close();
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [autoRefresh]);

  const logs = snapshot?.logs ?? EMPTY_LOGS;
  const workers = snapshot?.workers ?? EMPTY_WORKERS;

  const categories = useMemo(() => {
    const dynamic = new Set<string>();
    for (const entry of logs) {
      if (entry.category) dynamic.add(entry.category);
    }
    for (const categoryName of KNOWN_CATEGORIES) dynamic.add(categoryName);
    return [...dynamic].sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const visibleLogs = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (level && entry.level !== level) return false;
      if (category && entry.category !== category) return false;
      if (workerId && entry.worker_id !== workerId) return false;
      if (!normalized) return true;
      const metadata = metadataPreview(entry.metadata).toLowerCase();
      const haystack = `${entry.message} ${entry.category} ${entry.worker_id} ${
        entry.task_id ?? ""
      } ${metadata}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [category, level, logs, search, workerId]);

  const summary = useMemo(() => {
    const errors = visibleLogs.filter(
      (entry) => entry.level === "error",
    ).length;
    const warnings = visibleLogs.filter(
      (entry) => entry.level === "warn",
    ).length;
    const infos = visibleLogs.filter((entry) => entry.level === "info").length;
    const onlineWorkers = workers.filter((worker) =>
      isWorkerOnline(worker.last_seen),
    ).length;
    return { errors, warnings, infos, onlineWorkers };
  }, [visibleLogs, workers]);

  if (loading && !snapshot) {
    return (
      <div
        role="status"
        aria-label="Loading worker logs"
        aria-busy="true"
        className="flex justify-center py-16 text-text-muted"
      >
        <Loader2
          data-admin-ux="logs-loading"
          aria-hidden="true"
          className="h-5 w-5 animate-spin text-accent-action-hi"
        />
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <ErrorState message={error} onRetry={() => void fetchSnapshot(true)} />
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Logs"
        description="Live worker stream for enrichment, analysis, sync and system activity. Built for triage, not archaeology."
        compactActions
        actions={
          <PageHeaderActions>
            <>
              <PageHeaderAction
                label={autoRefresh ? "Pause live" : "Resume live"}
                onClick={() => setAutoRefresh((current) => !current)}
              >
                {autoRefresh ? (
                  <Pause
                    data-admin-ux="live-pause"
                    aria-hidden="true"
                    size={14}
                  />
                ) : (
                  <Play
                    data-admin-ux="live-resume"
                    aria-hidden="true"
                    size={14}
                  />
                )}
              </PageHeaderAction>
              <PageHeaderAction
                label="Refresh"
                onClick={() => void fetchSnapshot(true)}
              >
                <HeaderRefreshCw
                  data-admin-ux="header-refresh"
                  aria-hidden="true"
                />
              </PageHeaderAction>
            </>
          </PageHeaderActions>
        }
      >
        <InfoBadge active>{visibleLogs.length} lines</InfoBadge>
        <InfoBadge>
          {summary.onlineWorkers}/{workers.length} workers online
        </InfoBadge>
        {summary.errors > 0 ? (
          <InfoBadge tone="danger">{summary.errors} errors</InfoBadge>
        ) : null}
        {summary.warnings > 0 ? (
          <InfoBadge tone="warning">{summary.warnings} warnings</InfoBadge>
        ) : null}
        <OpsSnapshotStatus
          snapshot={snapshot?.snapshot}
          streamStatus={streamStatus}
        />
      </OpsPageHero>

      {error && snapshot ? (
        <OpsRefreshNotice
          message="Could not refresh worker logs. Showing the last successful snapshot."
          onRetry={() => void fetchSnapshot(true)}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile
          label="Errors"
          value={summary.errors.toLocaleString()}
          caption="Filtered lines at error level"
          tone={summary.errors > 0 ? "danger" : "default"}
        />
        <OpsStatTile
          label="Warnings"
          value={summary.warnings.toLocaleString()}
          caption="Things worth checking before they hard-fail"
          tone={summary.warnings > 0 ? "warning" : "default"}
        />
        <OpsStatTile
          label="Workers online"
          value={summary.onlineWorkers.toLocaleString()}
          caption={`${workers.length.toLocaleString()} known workers`}
          tone={summary.onlineWorkers > 0 ? "success" : "default"}
        />
        <OpsStatTile
          label="Info / debug"
          value={(
            summary.infos +
            visibleLogs.filter((entry) => entry.level === "debug").length
          ).toLocaleString()}
          caption="Operational noise still visible in the stream"
        />
      </div>

      <OpsPanel
        title="Filters"
        description="Shape the stream by severity, worker, category or free-text search without losing the live console feel."
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <SearchInput
            label="Search worker logs"
            containerClassName="flex-1 min-w-[240px]"
            value={search}
            onValueChange={setSearch}
            placeholder="Search messages, workers, task ids or metadata..."
          />
          <div className="crate-form-field max-w-full">
            <MonoLabel as="span" className="block">
              Log level
            </MonoLabel>
            <SegmentedControl
              as="radio"
              label="Log level"
              value={level}
              onValueChange={setLevel}
              items={[
                { value: "", label: "All levels" },
                { value: "error", label: "Error" },
                { value: "warn", label: "Warning" },
                { value: "info", label: "Info" },
                { value: "debug", label: "Debug" },
              ]}
            />
          </div>
          <AdminSelect
            value={category}
            onChange={setCategory}
            placeholder="All categories"
            options={categories.map((entry) => ({
              value: entry,
              label: entry,
            }))}
            searchable
            triggerClassName="min-h-11"
            searchPlaceholder="Filter categories..."
          />
          <AdminSelect
            value={workerId}
            onChange={setWorkerId}
            placeholder="All workers"
            options={workers.map((worker) => ({
              value: worker.worker_id,
              label: worker.worker_id,
              count: worker.log_count,
            }))}
            searchable
            triggerClassName="min-h-11"
            searchPlaceholder="Filter workers..."
          />
        </div>
      </OpsPanel>

      <OpsPanel
        title="Worker roster"
        description="Known workers, their recent heartbeat, and a quick way to isolate one noisy process from the rest."
      >
        {workers.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workers.map((worker) => (
              <WorkerTile
                key={worker.worker_id}
                worker={worker}
                active={workerId === worker.worker_id}
                onClick={() =>
                  setWorkerId((current) =>
                    current === worker.worker_id ? "" : worker.worker_id,
                  )
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState message="No worker heartbeat data available yet." />
        )}
      </OpsPanel>

      <OpsPanel
        title="Incident stream"
        description="Newest lines first. The console stays readable even when filtered down to one worker or one category."
      >
        <div className="overflow-hidden rounded-md border border-border-quiet bg-panel-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-quiet px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {level ? (
                <InfoBadge>
                  <SeverityMeter level={level} label={level} />
                </InfoBadge>
              ) : null}
              {category ? <InfoBadge>{category}</InfoBadge> : null}
              {workerId ? <InfoBadge>{workerId}</InfoBadge> : null}
              {search ? <InfoBadge>{search}</InfoBadge> : null}
              {!level && !category && !workerId && !search ? (
                <InfoBadge>All filters open</InfoBadge>
              ) : null}
            </div>
            <div className="text-xs text-text-muted">
              Showing {visibleLogs.length} of {logs.length} lines
            </div>
          </div>

          {visibleLogs.length === 0 ? (
            <EmptyState
              message="No log lines match the current filters."
              className="px-4"
            />
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {visibleLogs.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </OpsPanel>
    </div>
  );
}
