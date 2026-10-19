import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import {
  PageHeaderAction,
  PageHeaderActions,
  PageHeaderLayout,
} from "@/components/layout/PageHeader";
import {
  ScanSearch as HeaderScanSearch,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { SeverityMeter } from "@/components/admin/status-indicators";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { artistPagePath } from "@/lib/library-routes";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { timeAgo } from "@/lib/utils";
import { Button } from "@crate/ui/shadcn/button";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { useTaskEvents } from "@/hooks/use-task-events";
import {
  pickLatestRepairTask,
  taskNeedsAttention,
  type TaskInsightLike,
} from "@/lib/task-insights";

interface HealthIssue {
  id: number;
  check_type: string;
  severity: string;
  description: string;
  details_json: Record<string, unknown>;
  auto_fixable: boolean;
  status: string;
  created_at: string;
  artist_id?: number | null;
  album_id?: number | null;
  last_seen_at?: string | null;
}

interface HealthCheckRun {
  last_run_at: string | null;
  duration_ms: number;
  issue_count: number;
}

interface HealthSnapshotData {
  snapshot: {
    scope: string;
    subject_key: string;
    version: number;
    stale: boolean;
    generation_ms: number;
  };
  issues: HealthIssue[];
  counts: Record<string, number>;
  total: number;
  filter: string | null;
  runs?: Record<string, HealthCheckRun>;
}

export interface RepairCatalogEntry {
  check_type: string;
  scanner_method: string;
  fixer_method?: string | null;
  support: string;
  risk: string;
  scope: string;
  requires_confirmation: boolean;
  supports_batch: boolean;
  supports_artist_scope: boolean;
  supports_global_scope: boolean;
  supports_bulk_fix?: boolean;
  auto_fixable: boolean;
}

interface RepairCatalogResponse {
  items: RepairCatalogEntry[];
}

interface RepairHistoryTask extends TaskInsightLike {
  id: string;
  type: string;
  status: string;
  error: string | null;
  result: Record<string, unknown> | null;
  updated_at: string;
  created_at: string;
}

interface TasksSnapshotLite {
  history: RepairHistoryTask[];
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CHECK_LABELS: Record<string, string> = {
  duplicate_folders: "Duplicate Folders",
  canonical_mismatch: "Canonical Mismatch",
  fk_orphan_albums: "Orphan Albums",
  fk_orphan_tracks: "Orphan Tracks",
  stale_artists: "Stale Artists",
  stale_albums: "Stale Albums",
  stale_tracks: "Stale Tracks",
  zombie_artists: "Empty Artists",
  has_photo_desync: "Photo Desync",
  artist_layout_fix: "Artist Layout Fix",
  duplicate_albums: "Duplicate Albums",
  unindexed_files: "Unindexed Files",
  tag_mismatch: "Tag Mismatch",
  folder_naming: "Folder Naming",
  missing_cover: "Missing Covers",
  duplicate_tracks: "Duplicate Tracks",
  shadow_quality_tracks: "Lower Quality Copies",
};

const CHECK_DESCRIPTIONS: Record<string, string> = {
  duplicate_folders: "Multiple folders that normalize to the same artist name",
  canonical_mismatch:
    "Folder name doesn't match the canonical artist name from tags",
  fk_orphan_albums: "Albums in DB with no matching artist record",
  fk_orphan_tracks: "Tracks in DB with no matching album record",
  stale_artists: "Artists in DB with no folder on disk",
  stale_albums: "Albums in DB with no folder on disk",
  stale_tracks: "Tracks in DB with no file on disk",
  zombie_artists: "Artists with 0 albums and 0 tracks",
  has_photo_desync: "Artist photo flag in DB doesn't match filesystem",
  artist_layout_fix:
    "Artist filesystem layout or canonical entity-UID directory needs consolidation",
  duplicate_albums: "Same album name appears multiple times for an artist",
  unindexed_files: "Audio files on disk not indexed in DB",
  tag_mismatch: "Album artist tag doesn't match folder artist name",
  folder_naming: "Folder structure doesn't match the configured naming pattern",
  missing_cover: "Albums without cover art (cover.jpg/cover.png)",
  duplicate_tracks:
    "The same track appears more than once inside an album; the automatic cleanup skipped these",
  shadow_quality_tracks:
    "Lower quality copies of tracks that already exist in a better format",
};

const SCOPE_TONES: Record<string, string> = {
  db: "border-accent-action/20 bg-accent-action/[0.05] text-accent-action-hi",
  filesystem:
    "border-accent-action/20 bg-accent-action/[0.05] text-accent-action-hi",
  hybrid:
    "border-accent-action/20 bg-accent-action/[0.06] text-accent-action-hi",
};

function riskLabel(risk: string | undefined) {
  if (risk === "safe") return "Safe";
  if (risk === "caution") return "Needs review";
  if (risk === "destructive") return "Destructive";
  return "Unknown";
}

function scopeLabel(scope: string | undefined) {
  if (scope === "db") return "Database";
  if (scope === "filesystem") return "Filesystem";
  if (scope === "hybrid") return "DB + filesystem";
  return "Unknown scope";
}

export function fixAllMode(
  entry: RepairCatalogEntry | undefined,
  fixableCount: number,
): "none" | "global" | "bulk" {
  if (!entry?.auto_fixable || fixableCount <= 0) return "none";
  if (entry.supports_global_scope) return "global";
  if (entry.supports_bulk_fix) return "bulk";
  return "none";
}

function executionLane(entry: RepairCatalogEntry | undefined) {
  if (!entry) return "Unknown";
  if (entry.support === "manual" || !entry.auto_fixable) return "Manual only";
  if (entry.supports_global_scope) return "Global batch";
  if (entry.supports_artist_scope) return "Artist review";
  return "Review required";
}

function executionLaneTone(entry: RepairCatalogEntry | undefined) {
  if (!entry) return "border-white/10 bg-white/[0.04] text-white/55";
  if (entry.support === "manual" || !entry.auto_fixable)
    return "border-white/10 bg-white/[0.04] text-white/55";
  if (entry.supports_global_scope)
    return "border-accent-action/20 bg-accent-action/[0.06] text-accent-action-hi";
  return "border-state-warning/20 bg-state-warning/[0.06] text-state-warning-text";
}

export function latestRepairSummary(task: TaskInsightLike | null) {
  if (!task) return "No repair or health runs recorded yet.";
  if (task.error) return task.error;
  const result = task.result ?? {};
  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : null;
  const parts: string[] = [];
  if (task.type === "repair") {
    const summary =
      (result.summary as Record<string, unknown> | undefined) ?? {};
    for (const [key, label] of [
      ["applied", "applied"],
      ["skipped", "skipped"],
      ["failed", "failed"],
      ["unsupported", "manual"],
    ]) {
      const value = count(summary[key!]);
      if (value != null && (key === "applied" || value > 0))
        parts.push(`${value} ${label}`);
    }
  } else if (task.type === "fix_artist") {
    for (const [key, label] of [
      ["albums_fixed", "albums fixed"],
      ["synced_tracks", "tracks synced"],
    ]) {
      const value = count(result[key!]);
      if (value != null) parts.push(`${value} ${label}`);
    }
  } else if (task.type === "health_check") {
    const value = count(result.issue_count);
    return value == null
      ? "Result details unavailable"
      : `${value} issue${value === 1 ? "" : "s"} found`;
  }
  if (task.type === "repair" || task.type === "fix_artist") {
    const revalidation = result.revalidation as
      | Record<string, unknown>
      | undefined;
    const remaining = count(revalidation?.issue_count);
    if (remaining != null) parts.push(`${remaining} open after revalidation`);
  }
  return parts.length ? parts.join(", ") : "Result details unavailable";
}

export function groupHealthIssues(issues: HealthIssue[]) {
  const groups = new Map<
    string,
    { check: string; severity: string; items: HealthIssue[] }
  >();
  for (const issue of issues) {
    const group = groups.get(issue.check_type);
    if (!group)
      groups.set(issue.check_type, {
        check: issue.check_type,
        severity: issue.severity,
        items: [issue],
      });
    else {
      group.items.push(issue);
      if (
        (SEVERITY_ORDER[issue.severity] ?? 4) <
        (SEVERITY_ORDER[group.severity] ?? 4)
      )
        group.severity = issue.severity;
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4) ||
      a.check.localeCompare(b.check),
  );
}

function repairOutcomeLabel(task: RepairHistoryTask | null) {
  if (!task) return "No recent repair";
  if (task.status === "failed") return "Failed";
  if (taskNeedsAttention(task)) return "Needs attention";
  if (task.status === "completed") return "Completed";
  if (task.status === "cancelled") return "Cancelled";
  return task.status;
}

export function Health() {
  const { isAdmin } = useAuth();
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [runs, setRuns] = useState<Record<string, HealthCheckRun>>({});
  const [catalogByCheck, setCatalogByCheck] = useState<
    Record<string, RepairCatalogEntry>
  >({});
  const [latestRepairTask, setLatestRepairTask] =
    useState<RepairHistoryTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<string | null>(null);
  const [pendingBulkFix, setPendingBulkFix] = useState<{
    check: string;
    count: number;
  } | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const taskReconnectTimerRef = useRef<number | null>(null);
  const { done: activeTaskDone, reset: resetTaskEvents } =
    useTaskEvents(activeTaskId);

  async function fetchRepairCatalog() {
    try {
      const data = await api<RepairCatalogResponse>(
        "/api/manage/repair-catalog",
      );
      setCatalogByCheck(
        Object.fromEntries(data.items.map((item) => [item.check_type, item])),
      );
    } catch {
      // Keep health usable even if the catalog fails to load.
    }
  }

  function applyLatestRepair(history: RepairHistoryTask[]) {
    setLatestRepairTask(pickLatestRepairTask(history));
  }

  async function fetchLatestRepairTask(fresh = false) {
    try {
      const query = fresh ? "?limit=40&fresh=1" : "?limit=40";
      const data = await api<TasksSnapshotLite>(
        `/api/admin/tasks-snapshot${query}`,
      );
      applyLatestRepair(data.history ?? []);
    } catch {
      // Keep the rest of the surface usable if tasks snapshot is temporarily unavailable.
    }
  }

  const fetchIssues = useCallback(
    async (fresh = false, signal?: AbortSignal) => {
      try {
        const query = new URLSearchParams();
        if (filter) query.set("check_type", filter);
        if (fresh) query.set("fresh", "1");
        const suffix = query.toString() ? `?${query.toString()}` : "";
        const data = await api<HealthSnapshotData>(
          `/api/admin/health-snapshot${suffix}`,
          "GET",
          undefined,
          { signal },
        );
        if (signal?.aborted) return;
        setIssues(data.issues);
        setCounts(data.counts);
        setRuns(data.runs ?? {});
        setStale(data.snapshot?.stale === true);
        setError(null);
      } catch {
        setError("Failed to load health issues");
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  const fetchIssuesEvent = useEffectEvent(fetchIssues);

  useEffect(() => {
    const controller = new AbortController();
    void fetchIssues(false, controller.signal);
    return () => controller.abort();
  }, [fetchIssues]);

  useEffect(() => {
    void fetchRepairCatalog();
  }, []);

  useEffect(() => {
    void fetchLatestRepairTask();
  }, []);

  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;

    function connect() {
      if (disposed) return;
      const query = filter ? `?check_type=${encodeURIComponent(filter)}` : "";
      stream = new EventSource(`/api/admin/health-stream${query}`, {
        withCredentials: true,
      });
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as HealthSnapshotData;
          setIssues(payload.issues);
          setCounts(payload.counts);
          setRuns(payload.runs ?? {});
          setStale(payload.snapshot?.stale === true);
          setError(null);
          setLoading(false);
        } catch {
          // Ignore malformed payloads and wait for the next event.
        }
      };
      stream.onerror = () => {
        stream?.close();
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 3000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      stream?.close();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [filter]);

  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;

    function connect() {
      if (disposed) return;
      stream = new EventSource("/api/admin/tasks-stream?limit=40", {
        withCredentials: true,
      });
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as TasksSnapshotLite;
          applyLatestRepair(payload.history ?? []);
        } catch {
          // Ignore malformed payloads and wait for the next event.
        }
      };
      stream.onerror = () => {
        stream?.close();
        if (!disposed) {
          taskReconnectTimerRef.current = window.setTimeout(connect, 5000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      stream?.close();
      if (taskReconnectTimerRef.current !== null) {
        window.clearTimeout(taskReconnectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeTaskId || !activeTaskDone) return;
    if (activeTaskDone.status === "completed") {
      const revalidation = activeTaskDone.result?.revalidation as
        | Record<string, unknown>
        | undefined;
      const remaining = Number(revalidation?.issue_count ?? NaN);
      if (!scanning && Number.isFinite(remaining)) {
        toast.success(
          remaining > 0
            ? `Repair complete: ${remaining} issue${
                remaining === 1 ? "" : "s"
              } remain after revalidation`
            : "Repair complete: no open issues remain after revalidation",
        );
      } else {
        toast.success(scanning ? "Scan complete" : "Repair complete");
      }
      void fetchIssuesEvent(true);
      void fetchLatestRepairTask(true);
    } else if (activeTaskDone.status === "failed") {
      toast.error(scanning ? "Scan failed" : "Repair failed");
      void fetchLatestRepairTask(true);
    }
    setScanning(false);
    setFixing(null);
    setActiveTaskId(null);
    resetTaskEvents();
  }, [activeTaskDone, activeTaskId, resetTaskEvents, scanning]);

  async function runScan() {
    setScanning(true);
    try {
      const { task_id } = await api<{ task_id: string }>(
        "/api/manage/health-check",
        "POST",
      );
      toast.success("Health scan started...");
      setActiveTaskId(task_id);
    } catch {
      setScanning(false);
      toast.error("Failed to start scan");
    }
  }

  async function runDuplicateCleanup() {
    try {
      const result = await api<{ task_id: string; status?: string }>(
        "/api/manage/repair-duplicate-tracks",
        "POST",
      );
      toast.success(
        result.status === "already_queued"
          ? "Duplicate cleanup is already running"
          : "Duplicate cleanup queued",
      );
      if (result.task_id) setActiveTaskId(result.task_id);
    } catch {
      toast.error("Failed to start the duplicate cleanup");
    }
  }

  async function handleResolve(id: number) {
    await api(`/api/manage/health-issues/${id}/resolve`, "POST");
    removeIssue(id);
    toast.success("Issue resolved");
  }

  async function handleDismiss(id: number) {
    await api(`/api/manage/health-issues/${id}/dismiss`, "POST");
    removeIssue(id);
  }

  function removeIssue(id: number) {
    const issue = issues.find((i) => i.id === id);
    setIssues((prev) => prev.filter((i) => i.id !== id));
    if (issue) {
      setCounts((prev) => {
        const n = { ...prev };
        const val = (n[issue.check_type] || 1) - 1;
        if (val <= 0) delete n[issue.check_type];
        else n[issue.check_type] = val;
        return n;
      });
    }
  }

  async function handleFixType(checkType: string) {
    setFixing(checkType);
    try {
      const res = await api<{
        task_id: string | null;
        task_ids?: string[];
        fixable: number;
        allowed: boolean;
        reason?: string | null;
      }>(`/api/manage/health-issues/fix-type/${checkType}`, "POST");
      if (!res.task_id) {
        if (res.reason === "global_scope_not_supported") {
          toast.error("This repair must be reviewed artist-by-artist");
        } else if (res.reason === "not_auto_fixable") {
          toast.error("Automatic fix is not available for this repair type");
        } else {
          toast.error("No auto-fixable issues");
        }
        setFixing(null);
        return;
      }
      const batches = res.task_ids?.length ?? 1;
      toast.success(
        batches > 1
          ? `Fixing ${res.fixable} issues in ${batches} batches...`
          : `Fixing ${res.fixable} issues...`,
      );
      setActiveTaskId(res.task_id);
    } catch {
      setFixing(null);
      toast.error("Failed to start repair");
    }
  }

  async function handleDismissType(checkType: string) {
    await api(`/api/manage/health-issues/dismiss-type/${checkType}`, "POST");
    setIssues((prev) => prev.filter((i) => i.check_type !== checkType));
    setCounts((prev) => {
      const n = { ...prev };
      delete n[checkType];
      return n;
    });
    toast.success("All issues dismissed");
  }

  function toggleGroup(check: string) {
    setExpandedGroups((prev) => {
      const s = new Set(prev);
      if (s.has(check)) {
        s.delete(check);
      } else {
        s.add(check);
      }
      return s;
    });
  }

  const totalOpen = Object.values(counts).reduce((a, b) => a + b, 0);
  const lastScan =
    Object.values(runs).reduce<string | null>(
      (latest, run) =>
        run.last_run_at && (!latest || run.last_run_at > latest)
          ? run.last_run_at
          : latest,
      null,
    ) ?? null;
  const catalogItems = Object.values(catalogByCheck).sort((a, b) => {
    const countDiff = (counts[b.check_type] || 0) - (counts[a.check_type] || 0);
    if (countDiff !== 0) return countDiff;
    return (CHECK_LABELS[a.check_type] || a.check_type).localeCompare(
      CHECK_LABELS[b.check_type] || b.check_type,
    );
  });
  const grouped = groupHealthIssues(issues);
  const visibleCount = filter ? (counts[filter] ?? 0) : totalOpen;
  if (error)
    return (
      <ErrorState message={error} onRetry={() => void fetchIssues(true)} />
    );

  return (
    <div className="mx-auto w-full max-w-[70.5rem] min-w-0">
      <PageHeaderLayout
        as="header"
        actions={
          <PageHeaderActions>
            {isAdmin ? (
              <PageHeaderAction
                label={scanning ? "Scanning..." : "Run scan"}
                onClick={runScan}
                disabled={scanning}
                aria-busy={scanning}
              >
                {scanning ? (
                  <Loader2
                    data-admin-ux="health-scan-loading"
                    aria-hidden="true"
                    size={14}
                    className="animate-spin"
                  />
                ) : null}
                {!scanning ? (
                  <HeaderScanSearch
                    data-admin-ux="header-run-scan"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
            ) : null}
          </PageHeaderActions>
        }
      >
        <div>
          <h1 className="font-display text-[clamp(2.25rem,4.3vw,3.375rem)] font-bold leading-[1.05] tracking-display text-text-primary">
            Library Health
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Find problems in your library and how to resolve them.
          </p>
        </div>
      </PageHeaderLayout>
      <div className="mt-6 border-b border-border-quiet pb-8 text-text-muted">
        <p className="font-mono text-label">
          Latest check:{" "}
          {lastScan ? (
            <time dateTime={lastScan}>{timeAgo(lastScan)}</time>
          ) : (
            "unavailable"
          )}
        </p>
        {stale ? (
          <p role="status" className="mt-2 text-sm">
            Recorded results may be out of date.
          </p>
        ) : null}
      </div>

      <section aria-label="Library issues" className="mt-9 min-w-0">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-[1.6875rem] font-[650] tracking-tight text-text-primary">
            {loading ? "Library issues" : `${totalOpen} recorded issues`}
          </h2>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2">
            {!loading && grouped.length > 0 ? (
              <p className="text-xs text-text-muted">
                Loaded issues, most severe first
              </p>
            ) : null}
            {Object.keys(counts).length > 0 ? (
              <details className="min-w-0">
                <summary className="min-h-11 cursor-pointer py-3 text-xs text-text-muted">
                  Filter issues
                </summary>
                <div
                  className="flex flex-wrap gap-2 pt-2"
                  role="group"
                  aria-label="Filter by check"
                >
                  <FilterChip
                    active={filter === null}
                    onClick={() => setFilter(null)}
                  >
                    All{" "}
                    <span className="ml-1 text-text-muted">{totalOpen}</span>
                  </FilterChip>
                  {Object.entries(counts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([check, count]) => (
                      <FilterChip
                        key={check}
                        active={filter === check}
                        onClick={() => setFilter(check)}
                      >
                        {CHECK_LABELS[check] || check.replace(/_/g, " ")}{" "}
                        <span className="ml-1 text-text-muted">{count}</span>
                      </FilterChip>
                    ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
        {filter ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-text-muted">
            <p>Showing {CHECK_LABELS[filter] || filter.replace(/_/g, " ")}.</p>
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => setFilter(null)}
            >
              Clear filter
            </Button>
          </div>
        ) : null}
        {!loading && issues.length > 0 && issues.length < visibleCount ? (
          <p className="mb-4 text-sm text-text-muted">
            Showing {issues.length} of {visibleCount} recorded issues.
          </p>
        ) : null}
        {loading ? (
          <div
            role="status"
            aria-label="Loading health issues"
            className="flex justify-center py-16"
          >
            <Loader2
              data-admin-ux="health-loading"
              aria-hidden="true"
              className="h-6 w-6 animate-spin text-accent-action-hi"
            />
          </div>
        ) : null}
        {!loading && issues.length === 0 ? (
          <div className="border-t border-border-quiet py-10">
            <h3 className="font-display text-xl font-bold text-text-primary">
              {filter
                ? "No loaded issues for this filter"
                : totalOpen > 0
                  ? "No issue details loaded"
                  : lastScan
                    ? "No open issues recorded"
                    : "No check result available"}
            </h3>
            <p className="mt-3 text-sm text-text-muted">
              {filter || totalOpen > 0
                ? `${totalOpen} open issues recorded across the library.`
                : lastScan
                  ? "No open issues are recorded in the current results."
                  : "Run a scan to check the library for issues."}
            </p>
          </div>
        ) : null}
        {!loading &&
          grouped.map(({ check, severity, items }) => {
            const isExpanded = expandedGroups.has(check);
            const contentId = `health-issues-${encodeURIComponent(check)}`;
            const label = CHECK_LABELS[check] || check.replace(/_/g, " ");
            const description = CHECK_DESCRIPTIONS[check] || "";
            const catalogEntry = catalogByCheck[check];
            const fixableCount = items.filter((i) => i.auto_fixable).length;
            const isFixing = fixing === check;
            const fixAll = fixAllMode(catalogEntry, fixableCount);
            const canRunBulkFix = fixAll === "bulk";
            const canRunGlobalFix = fixAll !== "none";
            const hasArtistReview = Boolean(
              catalogEntry?.supports_artist_scope &&
                items.some((issue) => issue.artist_id),
            );
            const recordedCount = counts[check] ?? items.length;
            return (
              <article
                key={check}
                aria-labelledby={`${contentId}-title`}
                className="min-w-0 border-t border-border-quiet"
              >
                <div className="flex flex-wrap items-center justify-between gap-5 py-6">
                  <div
                    id={`${contentId}-summary`}
                    className="min-w-0 flex-1 basis-72"
                  >
                    <h3
                      id={`${contentId}-title`}
                      className="break-words font-display text-[1.4375rem] font-semibold leading-tight tracking-tight text-text-primary"
                    >
                      {label}
                    </h3>{" "}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-label text-text-muted">
                      <span>
                        {recordedCount}{" "}
                        {recordedCount === 1 ? "issue" : "issues"}
                      </span>{" "}
                      <SeverityMeter level={severity} label={severity} />{" "}
                      {catalogEntry ? (
                        <span className="sr-only">
                          {riskLabel(catalogEntry.risk)}{" "}
                          {scopeLabel(catalogEntry.scope)}
                        </span>
                      ) : null}{" "}
                      {runs[check]?.last_run_at ? (
                        <span>
                          Checked {timeAgo(runs[check]!.last_run_at!)}
                        </span>
                      ) : null}
                    </div>
                    {description ? (
                      <p className="mt-2 max-w-[45rem] text-caption leading-relaxed text-text-muted">
                        {description}
                      </p>
                    ) : null}
                    {catalogEntry?.requires_confirmation ? (
                      <span className="sr-only">
                        {" "}
                        Review artist-by-artist before applying this fix.
                      </span>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    className="min-h-11 shrink-0 gap-4 aria-expanded:text-accent-action-hi aria-expanded:hover:text-accent-action-hi"
                    onClick={() => toggleGroup(check)}
                    aria-label={`Review issues: ${label}`}
                    aria-expanded={isExpanded}
                    aria-controls={contentId}
                    aria-describedby={`${contentId}-summary`}
                  >
                    Review issues
                    {isExpanded ? (
                      <ChevronUp
                        data-admin-ux="health-group-collapse"
                        aria-hidden="true"
                        size={14}
                      />
                    ) : (
                      <ChevronDown
                        data-admin-ux="health-group-expand"
                        aria-hidden="true"
                        size={14}
                      />
                    )}
                  </Button>
                </div>
                {isExpanded ? (
                  <section
                    id={contentId}
                    aria-label={`${label} issues`}
                    className="mb-6 min-w-0 border-l border-accent-action pt-1 pb-6 pl-4 sm:pl-6"
                  >
                    {items.length < recordedCount ? (
                      <p className="mb-5 text-sm text-text-muted">
                        Showing {items.length} of {recordedCount} recorded
                        issues for this check.
                      </p>
                    ) : null}
                    <div className="grid min-w-0 items-start gap-8 md:grid-cols-2">
                      <div className="crate-form-field min-w-0">
                        <MonoLabel as="div" role="heading" aria-level={4}>
                          Detected cases
                        </MonoLabel>
                        <div className="min-w-0 space-y-4">
                          {groupIssuesByArtist(items).map((artistGroup) => (
                            <ArtistGroupHeader
                              key={artistGroup.key}
                              group={artistGroup}
                              canRepair={Boolean(
                                catalogEntry?.supports_artist_scope,
                              )}
                            >
                              {artistGroup.items.map((issue) => (
                                <IssueRow
                                  key={issue.id}
                                  issue={issue}
                                  onResolve={() => handleResolve(issue.id)}
                                  onDismiss={() => handleDismiss(issue.id)}
                                />
                              ))}
                            </ArtistGroupHeader>
                          ))}
                        </div>
                      </div>
                      <div className="crate-form-field min-w-0">
                        <MonoLabel as="div" role="heading" aria-level={4}>
                          How to resolve
                        </MonoLabel>
                        <div className="min-w-0 space-y-4">
                          <p className="text-caption leading-relaxed text-text-secondary">
                            {!catalogEntry
                              ? "Repair options are unavailable. You can still review these issues."
                              : catalogEntry.support === "manual"
                                ? "Automatic fix is not available for this repair type yet."
                                : catalogEntry.supports_global_scope
                                  ? "Global fix can be queued directly from here."
                                  : catalogEntry.supports_bulk_fix
                                    ? "Use Queue repair to queue artist repairs in batches of 20, or Review and repair for one artist."
                                    : "This repair is available from the artist repair flow, not as a global batch."}
                          </p>
                          {catalogEntry ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <SeverityMeter
                                level={catalogEntry.risk}
                                label={riskLabel(catalogEntry.risk)}
                              />
                              <InfoBadge
                                className={
                                  SCOPE_TONES[catalogEntry.scope] ||
                                  SCOPE_TONES.hybrid
                                }
                              >
                                {scopeLabel(catalogEntry.scope)}
                              </InfoBadge>
                              <span className="font-mono text-label text-text-muted">
                                {executionLane(catalogEntry)}
                              </span>
                            </div>
                          ) : null}
                          {catalogEntry?.requires_confirmation ? (
                            <p className="text-caption text-state-warning-text">
                              Review artist-by-artist before applying this fix.
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {canRunGlobalFix ? (
                              <Button
                                variant={
                                  hasArtistReview ? "outline" : "default"
                                }
                                className="min-h-11"
                                aria-label={`Queue repair for ${label}`}
                                onClick={() =>
                                  canRunBulkFix
                                    ? setPendingBulkFix({
                                        check,
                                        count: fixableCount,
                                      })
                                    : handleFixType(check)
                                }
                                disabled={isFixing}
                                aria-busy={isFixing}
                              >
                                {isFixing ? (
                                  <Loader2
                                    data-admin-ux="health-fix-loading"
                                    aria-hidden="true"
                                    size={12}
                                    className="mr-2 animate-spin"
                                  />
                                ) : null}
                                Queue repair
                              </Button>
                            ) : null}
                            {check === "duplicate_tracks" ? (
                              <Button
                                variant={
                                  hasArtistReview || canRunGlobalFix
                                    ? "outline"
                                    : "default"
                                }
                                className="min-h-11"
                                onClick={() => void runDuplicateCleanup()}
                              >
                                Run cleanup now
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              className="min-h-11 text-caption text-text-muted"
                              onClick={() => handleDismissType(check)}
                              title="Dismiss all issues of this type"
                              aria-label={`Dismiss all ${label} issues`}
                            >
                              Dismiss all
                            </Button>
                          </div>
                          {canRunGlobalFix ? (
                            <p className="text-xs text-text-muted">
                              {fixableCount} auto-fixable in the loaded results.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}
              </article>
            );
          })}
      </section>
      <details className="mt-6 border-t border-border-quiet pt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-text-secondary">
          Latest activity
          {latestRepairTask ? (
            <span className="ml-3 font-mono text-label text-text-muted">
              {repairOutcomeLabel(latestRepairTask)} ·{" "}
              {timeAgo(
                latestRepairTask.updated_at || latestRepairTask.created_at,
              )}
            </span>
          ) : null}
        </summary>
        <div className="space-y-3 py-3 text-sm text-text-secondary">
          {latestRepairTask ? (
            <>
              <p>{latestRepairSummary(latestRepairTask)}</p>
              <Button variant="ghost" className="min-h-11" asChild>
                <Link to={`/tasks?task=${latestRepairTask.id}`}>
                  View task log
                </Link>
              </Button>
            </>
          ) : (
            <p>No repair or health runs recorded yet.</p>
          )}
        </div>
      </details>
      {catalogItems.length > 0 ? (
        <details className="mt-4 border-t border-border-quiet pt-3">
          <summary className="min-h-11 cursor-pointer py-3 text-sm text-text-secondary">
            Available checks ({catalogItems.length})
          </summary>
          <ul className="divide-y divide-border-quiet">
            {catalogItems.map((entry) => (
              <li key={entry.check_type} className="space-y-3 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-sans text-lg font-bold">
                    {CHECK_LABELS[entry.check_type] ||
                      entry.check_type.replace(/_/g, " ")}
                  </h3>
                  <p className="font-mono text-label text-text-muted">
                    {counts[entry.check_type]
                      ? `${counts[entry.check_type]} open issues recorded`
                      : runs[entry.check_type]?.last_run_at
                        ? "No open issues recorded"
                        : "No check result available"}
                  </p>
                </div>
                <p className="text-sm text-text-muted">
                  {CHECK_DESCRIPTIONS[entry.check_type] ||
                    "No description available."}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <InfoBadge className={executionLaneTone(entry)}>
                    {executionLane(entry)}
                  </InfoBadge>
                  <SeverityMeter
                    level={entry.risk}
                    label={riskLabel(entry.risk)}
                  />
                  <span className="font-mono text-label text-text-muted">
                    {scopeLabel(entry.scope)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ConfirmDialog
        open={pendingBulkFix !== null}
        onOpenChange={(open) => !open && setPendingBulkFix(null)}
        title="Queue artist repairs"
        description={`Queue eligible ${
          CHECK_LABELS[pendingBulkFix?.check ?? ""] ?? "artist"
        } repairs across the library? ${pendingBulkFix?.count ?? 0} auto-fixable in the loaded results. ${
          pendingBulkFix && counts[pendingBulkFix.check] != null
            ? `${counts[pendingBulkFix.check]} open issues recorded for this check.`
            : "Recorded total unavailable for this check."
        } Files move on disk and each affected artist is re-synced afterwards.`}
        confirmLabel="Queue repairs"
        onConfirm={() => {
          void (() => {
            const check = pendingBulkFix?.check;
            setPendingBulkFix(null);
            if (check) void handleFixType(check);
          })();
        }}
        eyebrow="Confirm action"
        consequence="Check-wide eligible repairs · moves files on disk · re-syncs each affected artist"
      />
    </div>
  );
}

function IssueRow({
  issue,
  onResolve,
  onDismiss,
}: {
  issue: HealthIssue;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const details = issue.details_json || {};
  const path = details.path as string | undefined;
  const blockedReason =
    typeof details.cleanup_blocked_reason === "string"
      ? details.cleanup_blocked_reason
      : null;
  const paths = Array.isArray(details.paths)
    ? (details.paths as unknown[]).map(String).slice(0, 4)
    : [];

  return (
    <div className="grid min-w-0 gap-2 py-2">
      {/* Description */}
      <div className="flex-1 min-w-0">
        <div className="break-words text-caption leading-relaxed text-text-secondary">
          {issue.description}
        </div>
        {path && (
          <div className="mt-2 break-all font-mono text-label text-text-muted">
            {path}
          </div>
        )}
        {blockedReason ? (
          <div className="mt-1 text-[11px] text-state-warning-text/80">
            Automatic cleanup skipped it: {blockedReason}
          </div>
        ) : null}
        {paths.map((item) => (
          <div
            key={item}
            className="mt-2 break-all font-mono text-label text-text-muted"
          >
            {item}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <SeverityMeter level={issue.severity} label={issue.severity} />
          <span className="font-mono text-label text-text-muted">
            {timeAgo(issue.created_at)}
          </span>
        </div>
        {/* Actions remain visible beside secondary case metadata. */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
            className="min-h-11 text-caption text-text-muted hover:bg-accent-action/10 hover:text-accent-action-hi"
            title="Mark as resolved"
            aria-label="Mark as resolved"
          >
            Resolve
          </Button>
          <Button
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="min-h-11 text-caption text-text-muted hover:bg-white/10 hover:text-white"
            title="Dismiss: it stays hidden unless its details change"
            aria-label="Dismiss: it stays hidden unless its details change"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ArtistIssueGroup {
  key: string;
  artistId: number | null;
  artistName: string | null;
  items: HealthIssue[];
}

export function groupIssuesByArtist(items: HealthIssue[]): ArtistIssueGroup[] {
  const groups = new Map<string, ArtistIssueGroup>();
  for (const issue of items) {
    const details = issue.details_json || {};
    const artistName =
      (typeof details.artist === "string" && details.artist) ||
      (typeof details.db_artist === "string" && details.db_artist) ||
      null;
    const key = issue.artist_id
      ? `id:${issue.artist_id}`
      : artistName
        ? `name:${artistName}`
        : "none";
    const group = groups.get(key) ?? {
      key,
      artistId: issue.artist_id ?? null,
      artistName,
      items: [],
    };
    group.items.push(issue);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === "none") return 1;
    if (b.key === "none") return -1;
    return b.items.length - a.items.length;
  });
}

function ArtistGroupHeader({
  group,
  canRepair,
  children,
}: {
  group: ArtistIssueGroup;
  canRepair: boolean;
  children: ReactNode;
}) {
  if (!group.artistName && !group.artistId) {
    return (
      <div className="min-w-0 space-y-2">
        <p className="text-caption text-text-muted">
          Not linked to an artist ({group.items.length})
        </p>
        {children}
      </div>
    );
  }
  const href = artistPagePath({
    artistId: group.artistId ?? undefined,
    artistName: group.artistName ?? undefined,
  });
  return (
    <div className="min-w-0 space-y-2">
      <Link
        to={href}
        className="inline-flex min-h-11 min-w-0 max-w-full items-center text-caption text-text-secondary hover:text-accent-action-hi"
      >
        <span className="min-w-0 truncate">
          {group.artistName ?? `Artist #${group.artistId}`}
        </span>
        <span className="ml-2 shrink-0 text-white/40">
          {group.items.length}
        </span>
      </Link>
      {children}
      {canRepair && group.artistId ? (
        <Button className="min-h-11" asChild>
          <Link to={`${href}?repair=1`}>Review and repair</Link>
        </Button>
      ) : null}
    </div>
  );
}
