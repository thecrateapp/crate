import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { SeverityMeter } from "@/components/admin/status-indicators";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crate/ui/shadcn/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crate/ui/shadcn/dropdown-menu";
import {
  ChevronDown,
  ChevronUp,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from "@crate/ui/icons";
import { toast } from "sonner";

import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsSnapshotStatus,
  type OpsStreamStatus,
} from "@/components/admin/ops-surfaces";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  QueueLanes,
  type QueueLaneBreakdown,
  type QueueLaneTask,
  type QueueLaneTransition,
} from "@/components/admin/QueueLanes";
import { DbHeavyGate } from "@/components/admin/DbHeavyGate";
import { ResourceGovernorMonitor } from "@/components/admin/GovernorGauges";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";

import { Button } from "@crate/ui/shadcn/button";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { useTaskEvents } from "@/hooks/use-task-events";
import { api } from "@/lib/api";
import {
  isRepairTaskType,
  taskFamily,
  taskNeedsAttention,
  taskRevalidationIssueCount,
} from "@/lib/task-insights";
import { cn, timeAgo } from "@/lib/utils";
import { taskLabel, useTaskCatalog } from "@/lib/task-catalog";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

interface TaskProgress {
  phase?: string;
  phase_index?: number;
  phase_count?: number;
  item?: string;
  done?: number;
  total?: number;
  percent?: number;
  rate?: number;
  eta_sec?: number;
  errors?: number;
  warnings?: number;
  artist?: string;
  album?: string;
  step?: string;
  message?: string;
  track?: string;
  [key: string]: unknown;
}

interface Task {
  id: string;
  type: string;
  status: string;
  label?: string;
  progress: TaskProgress | string;
  error: string | null;
  params: Record<string, string> | null;
  result: Record<string, unknown> | null;
  priority?: number | null;
  pool?: string | null;
  created_at: string;
  started_at: string | null;
  cancellation_requested_at?: string | null;
  cancellation_acknowledged_at?: string | null;
  updated_at: string;
}

interface SettledTaskHighlight {
  status: string;
}

const EMPTY_TASKS: Task[] = [];
type WorkerQueueBreakdown = QueueLaneBreakdown;

interface DbHeavyGate {
  active: number;
  pending: number;
  blocking: boolean;
}

interface TasksSnapshotData {
  snapshot: {
    scope: string;
    subject_key: string;
    version: number;
    built_at?: string | null;
    stale_after?: string | null;
    stale: boolean;
    generation_ms: number;
  };
  live: {
    engine?: string;
    running_tasks: Array<{
      id: string;
      type: string;
      status?: string;
      pool?: string | null;
      progress: TaskProgress | string;
      created_at?: string | null;
      started_at?: string | null;
      updated_at?: string | null;
    }>;
    pending_tasks: Array<{
      id: string;
      type: string;
      status?: string;
      pool?: string | null;
      progress: TaskProgress | string;
      created_at?: string | null;
      started_at?: string | null;
      updated_at?: string | null;
    }>;
    recent_tasks: Array<{
      id: string;
      type: string;
      status: string;
      updated_at?: string | null;
    }>;
    worker_slots: { max: number; active: number };
    admission_policy?: {
      max_running: number;
      configured_revision: number;
      effective_revision: number | null;
    };
    queue_breakdown: WorkerQueueBreakdown;
    db_heavy_gate: DbHeavyGate;
    systems: { postgres: boolean; watcher: boolean };
  };
  history: Task[];
}

const STATUS_META: Record<
  string,
  {
    label: string;
    tone: "neutral" | "accent" | "success" | "warning" | "danger";
  }
> = {
  running: {
    label: "Running",
    tone: "accent",
  },
  pending: {
    label: "Pending",
    tone: "warning",
  },
  completed: {
    label: "Completed",
    tone: "success",
  },
  failed: {
    label: "Failed",
    tone: "danger",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
  },
};

function getStatusMeta(status: string) {
  return (
    STATUS_META[status] ?? {
      label: status,
      tone: "neutral",
    }
  );
}

const FAMILY_META: Record<string, { label: string }> = {
  repair: { label: "Repair" },
  acquisition: { label: "Acquisition" },
  analysis: { label: "Analysis" },
  sync: { label: "Sync" },
  enrichment: { label: "Enrichment" },
  playback: { label: "Playback" },
  other: { label: "Other" },
};

function getTaskLabel(task: Task): string {
  const base = task.label || taskLabel(task.type);
  const params = task.params;
  if (!params) return base;
  if (params.artist && params.album)
    return `${base}: ${params.artist} / ${params.album}`;
  if (params.artist) return `${base}: ${params.artist}`;
  if (params.name) return `${base}: ${params.name}`;
  if (params.artist_folder && params.album_folder)
    return `${base}: ${params.artist_folder} / ${params.album_folder}`;
  return base;
}

function describeResult(task: Task): string {
  if (task.error)
    return task.error.length > 120
      ? `${task.error.slice(0, 120)}…`
      : task.error;
  const result = task.result;
  if (!result) return task.status === "completed" ? "Completed" : "";

  const type = task.type;

  if (type === "process_new_content") {
    const steps = result.steps as Record<string, unknown> | undefined;
    if (steps) {
      const done = Object.entries(steps).filter(
        ([, value]) => value !== "failed" && value !== false,
      ).length;
      const failed = Object.entries(steps).filter(
        ([, value]) => value === "failed",
      ).length;
      return `${done} steps done${failed ? `, ${failed} failed` : ""}`;
    }
  }

  if (type === "enrich_artist") {
    if (result.skipped) return "Skipped (recently enriched)";
    return "Artist enriched";
  }

  if (type === "enrich_artists" || type === "enrich_mbids") {
    const parts: string[] = [];
    if (result.enriched) parts.push(`${result.enriched} enriched`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    if (result.failed) parts.push(`${result.failed} failed`);
    return parts.join(", ") || "Done";
  }

  if (type === "analyze_tracks" || type === "analyze_all") {
    return `${result.analyzed ?? 0} tracks analyzed${
      result.failed ? `, ${result.failed} failed` : ""
    }`;
  }

  if (type === "compute_bliss") {
    return `${result.analyzed ?? 0} tracks vectorized${
      result.failed ? `, ${result.failed} failed` : ""
    }`;
  }

  if (type === "compute_popularity") {
    const parts: string[] = [];
    if (result.albums) parts.push(`${result.albums} albums`);
    if (result.tracks) parts.push(`${result.tracks} tracks`);
    return parts.join(", ") || "Done";
  }

  if (type === "health_check") return `${result.issue_count ?? 0} issues found`;
  if (type === "repair") {
    const summary =
      (result.summary as Record<string, unknown> | undefined) ?? {};
    const applied = Number(summary.applied ?? 0);
    const skipped = Number(summary.skipped ?? 0);
    const failed = Number(summary.failed ?? 0);
    const manual = Number(summary.unsupported ?? 0);
    const remaining = taskRevalidationIssueCount(result);
    const parts = [`${applied} applied`];
    if (skipped) parts.push(`${skipped} skipped`);
    if (failed) parts.push(`${failed} failed`);
    if (manual) parts.push(`${manual} manual`);
    if (remaining != null) parts.push(`${remaining} open after revalidation`);
    return `${parts.join(", ")}${
      result.fs_changed ? " (filesystem modified)" : ""
    }`;
  }
  if (type === "fix_artist") {
    const albumsFixed = Number(result.albums_fixed ?? 0);
    const syncedTracks = Number(result.synced_tracks ?? 0);
    return `${albumsFixed} albums fixed, ${syncedTracks} tracks synced`;
  }

  if (type === "library_sync" || type === "library_pipeline") {
    const parts: string[] = [];
    if (result.artists_added) parts.push(`+${result.artists_added} artists`);
    if (result.tracks_total) parts.push(`${result.tracks_total} tracks`);
    return parts.join(", ") || "Synced";
  }

  if (type === "match_apply")
    return `${result.updated ?? 0}/${result.total ?? "?"} tracks tagged`;
  if (type === "delete_artist" || type === "delete_album") return "Deleted";
  if (type === "compute_analytics") return "Analytics computed";
  if (type === "tidal_download")
    return result.error ? String(result.error) : "Downloaded";

  const keys = Object.keys(result);
  if (keys.length === 0) return "Done";
  if (keys.length <= 3)
    return keys
      .map((key) => `${key}: ${JSON.stringify(result[key])}`)
      .join(", ");
  return `${keys.length} fields`;
}

function isRepairTask(task: Task): boolean {
  return isRepairTaskType(task.type);
}

function formatDuration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function ProgressSummary({
  progress,
  active,
}: {
  progress: TaskProgress | string;
  active: boolean;
}) {
  if (typeof progress === "string") {
    return progress ? (
      <div className="text-xs text-text-muted">{progress}</div>
    ) : null;
  }

  const done = Number(progress.done ?? 0);
  const total = Number(progress.total ?? 0);
  const percent =
    progress.percent != null
      ? Number(progress.percent)
      : total > 0
        ? Math.round((done / total) * 100)
        : 0;

  if (total > 0) {
    return (
      <div className="space-y-2">
        <ProgressHairline
          label="Task progress"
          value={percent / 100}
          valueText={`${done}/${total} (${percent}%)`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
          <div className="flex flex-wrap items-center gap-2">
            {progress.phase ? (
              <InfoBadge>{String(progress.phase)}</InfoBadge>
            ) : null}
            {progress.item ? (
              <span className="text-text-secondary">
                {String(progress.item)}
              </span>
            ) : null}
            {!progress.item && progress.artist ? (
              <span className="text-text-secondary">
                {String(progress.artist)}
              </span>
            ) : null}
          </div>
          <div className="tabular-nums">
            {done}/{total} ({percent}%)
            {progress.rate != null && Number(progress.rate) > 0 ? (
              <span className="ml-2 text-text-subtle">
                {Number(progress.rate).toFixed(1)}/s
              </span>
            ) : null}
            {progress.eta_sec != null && Number(progress.eta_sec) > 0 ? (
              <span className="ml-2 text-text-subtle">
                ETA {Number(progress.eta_sec)}s
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const description = progress.step
    ? `Step: ${String(progress.step).replace(/_/g, " ")}`
    : String(progress.message ?? progress.phase ?? "");
  return description ? (
    <div className="space-y-2">
      {active ? (
        <ProgressHairline label="Task progress" valueText={description} />
      ) : null}
      <div className="text-xs text-text-muted">{description}</div>
    </div>
  ) : null;
}

function eventTone(eventType: string) {
  if (eventType.includes("fail") || eventType === "error") return "danger";
  if (eventType.includes("warn")) return "warning";
  return "neutral";
}

function eventMessage(event: { type: string; data?: Record<string, unknown> }) {
  if (event.type === "item" && event.data) {
    const outcome =
      typeof event.data.outcome === "string" ? event.data.outcome : null;
    const action =
      typeof event.data.action === "string"
        ? event.data.action.replace(/_/g, " ")
        : null;
    const target =
      typeof event.data.target === "string" ? event.data.target : null;
    if (event.data.message) return String(event.data.message);
    if (outcome && action && target)
      return `${outcome}: ${action} -> ${target}`;
  }
  if (event.data?.message) return String(event.data.message);
  if (event.data?.step) return String(event.data.step).replace(/_/g, " ");
  if (event.data) {
    const keys = Object.keys(event.data);
    if (keys.length <= 3)
      return keys.map((key) => `${key}: ${event.data![key]}`).join(", ");
  }
  return event.type.replace(/_/g, " ");
}

function taskDoneMessage(
  done: {
    status: string;
    result?: Record<string, unknown>;
    error?: string;
  } | null,
) {
  if (!done) return null;
  if (done.error) return done.error;
  if (done.status === "completed") {
    if (typeof done.result?.message === "string") return done.result.message;
    return "Task completed";
  }
  if (done.status === "failed") return "Task failed";
  if (done.status === "cancelled") return "Task cancelled";
  return done.status;
}

function TaskDoneBanner({
  done,
}: {
  done: {
    status: string;
    result?: Record<string, unknown>;
    error?: string;
  } | null;
}) {
  if (!done) return null;
  const status = getStatusMeta(done.status);
  const message = taskDoneMessage(done);
  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-2 text-xs"
    >
      <InfoBadge tone={status.tone}>{status.label}</InfoBadge>
      {message ? <span className="text-text-secondary">{message}</span> : null}
    </div>
  );
}

type TaskEventViewState = Pick<
  ReturnType<typeof useTaskEvents>,
  "events" | "connected" | "done"
>;

function LiveTaskEvents({
  taskId,
  stream,
}: {
  taskId: string;
  stream: TaskEventViewState;
}) {
  const { events, connected, done } = stream;

  if (events.length === 0) {
    if (done) {
      return (
        <div className="py-3">
          <TaskDoneBanner done={done} />
        </div>
      );
    }
    return (
      <div className="py-3 text-xs text-text-muted">
        {connected ? "Waiting for live events…" : "Connecting to task stream…"}
      </div>
    );
  }

  return (
    <div className="max-h-[280px] space-y-1 overflow-y-auto py-3 font-mono">
      <TaskDoneBanner done={done} />
      {events.map((event) => (
        <div
          key={`${taskId}-${
            event.id ||
            `${event.timestamp}-${event.type}-${String(
              event.data.message ?? "",
            )}`
          }`}
          className="flex items-start gap-2 text-xs"
        >
          <span className="w-16 shrink-0 text-[10px] text-text-subtle">
            {new Date(event.timestamp || Date.now()).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          {["info", "warning", "warn", "error"].includes(event.type) ? (
            <SeverityMeter level={event.type} label={event.type} />
          ) : (
            <InfoBadge tone={eventTone(event.type)}>
              {event.type.replace(/_/g, " ")}
            </InfoBadge>
          )}
          <span className="text-text-secondary">{eventMessage(event)}</span>
        </div>
      ))}
    </div>
  );
}

function TaskEventLog({
  taskId,
  emptyMessage = "No task log recorded.",
}: {
  taskId: string;
  emptyMessage?: string;
}) {
  const { events, connected, done } = useTaskEvents(taskId);

  if (events.length === 0) {
    if (done) {
      return (
        <div className="py-3">
          <TaskDoneBanner done={done} />
        </div>
      );
    }
    if (connected && !done) {
      return (
        <div className="py-3 text-xs text-text-muted">Loading task log…</div>
      );
    }
    return <div className="py-3 text-xs text-text-muted">{emptyMessage}</div>;
  }

  return (
    <div className="max-h-[320px] space-y-1 overflow-y-auto py-3 font-mono">
      <TaskDoneBanner done={done} />
      {events.map((event) => (
        <div
          key={`${taskId}-${
            event.id ||
            `${event.timestamp}-${event.type}-${String(
              event.data.message ?? "",
            )}`
          }`}
          className="flex items-start gap-2 text-xs"
        >
          <span className="w-16 shrink-0 text-[10px] text-text-subtle">
            {new Date(event.timestamp || Date.now()).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          {["info", "warning", "warn", "error"].includes(event.type) ? (
            <SeverityMeter level={event.type} label={event.type} />
          ) : (
            <InfoBadge tone={eventTone(event.type)}>
              {event.type.replace(/_/g, " ")}
            </InfoBadge>
          )}
          <span className="text-text-secondary">{eventMessage(event)}</span>
        </div>
      ))}
    </div>
  );
}

function WorkerControlPanel({
  engine,
  running,
  pending,
  slotLimit,
  queueBreakdown,
  dbHeavyGate,
  activeTasks,
  runningTasks,
  pendingTasks,
  doneTasks,
  taskTransitions,
  taskTypeCount,
  onTaskSelect,
  refreshTasks,
}: {
  engine: string;
  running: number;
  pending: number;
  slotLimit: number;
  queueBreakdown: WorkerQueueBreakdown;
  dbHeavyGate: DbHeavyGate;
  activeTasks: { id: string; type: string; pool?: string | null }[];
  runningTasks: QueueLaneTask[];
  pendingTasks: QueueLaneTask[];
  doneTasks: QueueLaneTask[];
  taskTransitions: QueueLaneTransition[];
  taskTypeCount?: number;
  onTaskSelect: (taskId: string) => void;
  refreshTasks: (fresh?: boolean) => Promise<void>;
}) {
  const [restarting, setRestarting] = useState(false);

  async function setSlots(next: number) {
    try {
      await api("/api/worker/slots", "POST", { slots: next });
      await refreshTasks(true);
      toast.success(`Task concurrency limit set to ${next}`);
    } catch {
      toast.error("Failed to update worker slots");
    }
  }

  async function restartWorker() {
    setRestarting(true);
    try {
      await api("/api/worker/restart", "POST");
      await refreshTasks(true);
      toast.success("crate-worker is restarting…");
    } catch {
      toast.error("Failed to restart crate-worker");
    } finally {
      setTimeout(() => setRestarting(false), 5000);
    }
  }

  async function cancelAll() {
    try {
      const response = await api<{ cancelled: number; skipped?: number }>(
        "/api/worker/cancel-all",
        "POST",
      );
      await refreshTasks(true);
      const message = `Cancellation requested for ${response.cancelled} ${
        response.cancelled === 1 ? "task" : "tasks"
      }`;
      if (response.skipped) {
        toast.error(
          `${message}. ${response.skipped} ${
            response.skipped === 1 ? "task" : "tasks"
          } could not be cancelled; review current states.`,
        );
      } else {
        toast.success(message);
      }
    } catch {
      toast.error("Failed to cancel tasks");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <InfoBadge active>{engine}</InfoBadge>
          <InfoBadge>{running} running</InfoBadge>
          <InfoBadge>{pending} pending</InfoBadge>
          <InfoBadge>{slotLimit} concurrent tasks</InfoBadge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Worker concurrency controls"
            className="flex items-center gap-1"
          >
            <PageHeaderAction
              label="Decrease worker concurrency"
              onClick={() => setSlots(Math.max(1, slotLimit - 1))}
              disabled={slotLimit <= 1}
            >
              <Minus aria-hidden="true" />
            </PageHeaderAction>
            <InfoBadge variant="counter">{slotLimit}</InfoBadge>
            <PageHeaderAction
              label="Increase worker concurrency"
              onClick={() => setSlots(Math.min(64, slotLimit + 1))}
              disabled={slotLimit >= 64}
            >
              <Plus aria-hidden="true" />
            </PageHeaderAction>
          </div>
          <PageHeaderAction asChild label="Worker logs">
            <Link to="/logs">
              <ListOrdered aria-hidden="true" />
            </Link>
          </PageHeaderAction>
          <PageHeaderAction label="Cancel all tasks" onClick={cancelAll}>
            <X aria-hidden="true" />
          </PageHeaderAction>
          <PageHeaderAction
            label={
              restarting ? "Restarting crate-worker" : "Restart crate-worker"
            }
            tooltip="Restarts crate-worker: default and fast queues plus its service loop."
            onClick={restartWorker}
            loading={restarting}
          >
            <RotateCcw aria-hidden="true" />
          </PageHeaderAction>
        </div>
      </div>

      <div className="flex gap-1">
        {Array.from({ length: slotLimit }, (_, slot) => ({
          key: `slot-${slot}`,
          task: activeTasks[slot],
        })).map(({ key, task }, slot) => (
          <TooltipHint
            key={key}
            content={
              task
                ? `${taskLabel(task.type)}${task.pool ? ` · ${task.pool}` : ""}`
                : "Idle worker slot"
            }
          >
            <div
              role="img"
              aria-label={`Worker slot ${slot + 1}: ${
                task
                  ? `${taskLabel(task.type)}${task.pool ? ` · ${task.pool}` : ""}`
                  : "Idle"
              }`}
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center justify-center rounded-md border px-2 text-xs transition-colors",
                task
                  ? "border-accent-action/25 bg-accent-action/10 text-accent-action-hi"
                  : "border-border-quiet bg-app-surface text-text-subtle",
              )}
            >
              <span className="truncate">
                {task ? taskLabel(task.type) : "idle"}
              </span>
            </div>
          </TooltipHint>
        ))}
      </div>

      <div className="space-y-3">
        <QueueLanes
          breakdown={queueBreakdown}
          runningTasks={runningTasks}
          pendingTasks={pendingTasks}
          doneTasks={doneTasks}
          transitions={taskTransitions}
          taskTypeCount={taskTypeCount}
          onTaskSelect={onTaskSelect}
        />
        <div className="flex flex-col gap-10">
          <ResourceGovernorMonitor />
          <DbHeavyGate gate={dbHeavyGate} />
        </div>
      </div>
    </div>
  );
}

function ActiveTaskCard({
  task,
  expanded,
  onExpand,
  onCancel,
}: {
  task: Task;
  expanded: boolean;
  onExpand: () => void;
  onCancel: () => void;
}) {
  const taskEventStream = useTaskEvents(task.id);
  const { events, done } = taskEventStream;
  const liveStatus = done?.status || task.status;
  const status = getStatusMeta(liveStatus);
  const latestMessage = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const message = events[index]?.data?.message;
      if (typeof message === "string" && message.trim()) return message;
    }
    return taskDoneMessage(done);
  }, [done, events]);

  return (
    <article className="min-w-0 py-4 transition-colors pointer-fine:hover:bg-accent-action/[0.04]">
      <div className="space-y-3 px-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-primary">
                {getTaskLabel(task)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <InfoBadge tone={status.tone}>{status.label}</InfoBadge>
                {task.cancellation_requested_at &&
                !task.cancellation_acknowledged_at &&
                !["completed", "failed", "cancelled"].includes(task.status) ? (
                  <InfoBadge tone="warning">Cancellation requested</InfoBadge>
                ) : null}
                {task.pool ? <InfoBadge>{task.pool}</InfoBadge> : null}
                <span>
                  {liveStatus === "running" && task.started_at
                    ? `Running for ${formatDuration(
                        task.started_at,
                        new Date().toISOString(),
                      )}`
                    : `Queued ${timeAgo(task.created_at)}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {liveStatus === "running" || Boolean(done) ? (
              <Button variant="outline" onClick={onExpand}>
                {expanded ? "Hide live" : done ? "Task log" : "Live events"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={Boolean(done)}
            >
              Cancel
            </Button>
          </div>
        </div>

        <ProgressSummary
          progress={task.progress}
          active={!["completed", "failed", "cancelled"].includes(liveStatus)}
        />
        {latestMessage ? (
          <div className="text-xs text-text-muted">{latestMessage}</div>
        ) : null}
      </div>

      {expanded && (liveStatus === "running" || Boolean(done)) ? (
        <div className="mt-4 border-t border-border-quiet pt-3">
          <LiveTaskEvents taskId={task.id} stream={taskEventStream} />
        </div>
      ) : null}
    </article>
  );
}

function HistoryTaskRow({
  task,
  expanded,
  onToggle,
  onRetry,
  highlightStatus,
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  highlightStatus?: string | null;
}) {
  const status = getStatusMeta(task.status);
  const summary = describeResult(task);
  const showHumanLog = task.type === "repair" || task.type === "fix_artist";
  const highlightMeta = highlightStatus ? getStatusMeta(highlightStatus) : null;
  const family = taskFamily(task.type);
  const familyMeta = FAMILY_META[family] ?? { label: "Other" };
  const needsAttention = taskNeedsAttention(task);

  return (
    <div
      className={cn(
        "min-w-0 transition-colors duration-700",
        highlightMeta?.tone === "success" && "bg-accent-action/[0.04]",
        highlightMeta?.tone === "danger" && "bg-state-warning/[0.04]",
        highlightMeta?.tone === "neutral" && "bg-text-primary/[0.03]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="crate-focus-inset group flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-text-primary transition-colors group-hover:text-accent-action-hi">
                {getTaskLabel(task)}
              </span>
              <InfoBadge tone={status.tone}>{status.label}</InfoBadge>
              <InfoBadge>{familyMeta.label}</InfoBadge>
              {needsAttention ? (
                <InfoBadge tone="warning">Needs attention</InfoBadge>
              ) : null}
              {highlightMeta ? (
                <InfoBadge tone={highlightMeta.tone}>Just finished</InfoBadge>
              ) : null}
            </div>
            <div className="mt-1 truncate text-xs text-text-muted">
              {summary || "No summary available"}
            </div>
          </div>
          <div className="hidden text-xs text-text-subtle sm:block">
            {formatDuration(
              task.started_at || task.created_at,
              task.updated_at,
            )}
          </div>
          <div className="hidden text-xs text-text-subtle xl:block">
            {timeAgo(task.updated_at)}
          </div>
          {expanded ? (
            <ChevronUp
              size={14}
              className="shrink-0 text-text-subtle"
              aria-hidden="true"
            />
          ) : (
            <ChevronDown
              size={14}
              className="shrink-0 text-text-subtle"
              aria-hidden="true"
            />
          )}
        </button>
        {task.status === "failed" ? (
          <PageHeaderAction
            label={`Retry ${getTaskLabel(task)}`}
            tooltip="Retry task"
            onClick={onRetry}
          >
            <RotateCcw aria-hidden="true" />
          </PageHeaderAction>
        ) : null}
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-border-quiet px-4 py-4">
          <dl className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt>
                <MonoLabel as="span" size="eyebrow">
                  ID
                </MonoLabel>
              </dt>
              <dd className="mb-0 mt-1 break-all font-mono text-text-secondary">
                {task.id}
              </dd>
            </div>
            <div>
              <dt>
                <MonoLabel as="span" size="eyebrow">
                  Type
                </MonoLabel>
              </dt>
              <dd className="mb-0 mt-1 break-words font-mono text-text-secondary">
                {task.type}
              </dd>
            </div>
            <div>
              <dt>
                <MonoLabel as="span" size="eyebrow">
                  Created
                </MonoLabel>
              </dt>
              <dd className="mb-0 mt-1 text-text-secondary">
                <time dateTime={task.created_at}>
                  {new Date(task.created_at).toLocaleString()}
                </time>
              </dd>
            </div>
            <div>
              <dt>
                <MonoLabel as="span" size="eyebrow">
                  Duration
                </MonoLabel>
              </dt>
              <dd className="mb-0 mt-1 text-text-secondary">
                {formatDuration(
                  task.started_at || task.created_at,
                  task.updated_at,
                )}
              </dd>
            </div>
          </dl>

          {task.params && Object.keys(task.params).length > 0 ? (
            <div className="space-y-2">
              <MonoLabel as="div" size="eyebrow">
                Params
              </MonoLabel>
              <pre className="overflow-x-auto rounded-md border border-border-quiet bg-panel-surface p-3 text-xs text-text-secondary">
                {JSON.stringify(task.params, null, 2)}
              </pre>
            </div>
          ) : null}

          {task.error ? (
            <div className="space-y-2">
              <MonoLabel as="div" size="eyebrow">
                Error
              </MonoLabel>
              <pre className="overflow-x-auto rounded-md border border-state-warning/20 bg-state-warning/[0.05] p-3 text-xs text-state-warning-text">
                {task.error}
              </pre>
            </div>
          ) : null}

          {showHumanLog ? (
            <div className="space-y-2">
              <MonoLabel as="div" size="eyebrow">
                Task log
              </MonoLabel>
              <TaskEventLog taskId={task.id} />
            </div>
          ) : task.result ? (
            <div className="space-y-2">
              <MonoLabel as="div" size="eyebrow">
                Result
              </MonoLabel>
              <pre className="max-h-[320px] overflow-auto rounded-md border border-border-quiet bg-panel-surface p-3 text-xs text-text-secondary">
                {JSON.stringify(task.result, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Tasks() {
  const taskCatalog = useTaskCatalog();
  const [tasksSnapshot, setTasksSnapshot] = useState<TasksSnapshotData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] =
    useState<OpsStreamStatus>("connecting");
  const [taskTransitions, setTaskTransitions] = useState<QueueLaneTransition[]>(
    [],
  );
  const [searchParams] = useSearchParams();
  const [taskTab, setTaskTab] = useState<"active" | "attention" | "history">(
    () => (searchParams.has("task") ? "history" : "active"),
  );
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [filterFamily, setFilterFamily] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const autoExpandedRepairRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const taskTransitionSequenceRef = useRef(0);
  const previousActiveIdsRef = useRef<Set<string>>(new Set());
  const highlightTimersRef = useRef<Record<string, number>>({});
  const [settledHighlights, setSettledHighlights] = useState<
    Record<string, SettledTaskHighlight>
  >({});

  const fetchSnapshot = useCallback(async (fresh = false) => {
    if (!loadedRef.current) {
      setLoading(true);
    }
    try {
      const query = fresh ? "?limit=100&fresh=1" : "?limit=100";
      const snapshot = await api<TasksSnapshotData>(
        `/api/admin/tasks-snapshot${query}`,
      );
      setTasksSnapshot(snapshot);
      setError(null);
      loadedRef.current = true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load task orchestration",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;

    function connect() {
      if (disposed) return;
      stream = new EventSource("/api/admin/tasks-stream?limit=100", {
        withCredentials: true,
      });
      stream.onopen = () => setStreamStatus("live");
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as TasksSnapshotData;
          setTasksSnapshot(payload);
          setError(null);
          setStreamStatus("live");
          setLoading(false);
          loadedRef.current = true;
        } catch {
          // Ignore malformed snapshots.
        }
      };
      stream.addEventListener("task_transition", (event) => {
        try {
          const task = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as QueueLaneTask | null;
          if (
            !task ||
            typeof task.id !== "string" ||
            typeof task.type !== "string" ||
            typeof task.status !== "string"
          ) {
            return;
          }
          const transition: QueueLaneTransition = {
            ...task,
            sequence: ++taskTransitionSequenceRef.current,
          };
          setTaskTransitions((current) => [...current.slice(-99), transition]);
          setStreamStatus("live");
        } catch {
          // Ignore malformed lifecycle events; snapshots remain authoritative.
        }
      });
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
  }, []);

  const tasks = tasksSnapshot?.history ?? EMPTY_TASKS;
  const live = tasksSnapshot?.live;

  useEffect(() => {
    const highlightedTask = searchParams.get("task");
    if (!highlightedTask) return;
    const historicalTask = tasks.find((task) => task.id === highlightedTask);
    if (historicalTask) {
      setExpandedId(highlightedTask);
      setTaskTab(
        ["running", "pending"].includes(historicalTask.status)
          ? "active"
          : taskNeedsAttention(historicalTask)
            ? "attention"
            : "history",
      );
    }
  }, [searchParams, tasks]);

  async function handleCancel(id: string) {
    const result = await api<{ status: string }>(
      `/api/tasks/${id}/cancel`,
      "POST",
    );
    toast.success(
      result.status === "cancelled"
        ? "Task cancelled"
        : "Cancellation requested",
    );
    await fetchSnapshot(true);
  }

  async function handleRetry(task: Task) {
    try {
      await api("/api/tasks/retry", "POST", { task_id: task.id });
      toast.success(`Retrying ${getTaskLabel(task)}`);
      await fetchSnapshot(true);
    } catch {
      toast.error("Failed to retry task");
    }
  }

  async function cleanupOlder() {
    try {
      const response = await api<{ deleted: number }>(
        "/api/tasks/cleanup",
        "POST",
        { older_than_days: 7 },
      );
      toast.success(`Cleaned up ${response.deleted} old tasks`);
      await fetchSnapshot(true);
    } catch {
      toast.error("Cleanup failed");
    }
  }

  async function cleanStatus(status: "completed" | "failed" | "cancelled") {
    try {
      const response = await api<{ deleted: number }>(
        `/api/tasks/clean/${status}`,
        "POST",
      );
      toast.success(`Cleaned ${response.deleted} ${status} tasks`);
      await fetchSnapshot(true);
    } catch {
      toast.error(`Failed to clean ${status} tasks`);
    }
  }

  function selectQueueTask(taskId: string) {
    setExpandedId(taskId);
    const selectedTask = tasks.find((task) => task.id === taskId);
    if (!selectedTask) {
      setTaskTab("active");
      return;
    }
    setTaskTab(
      ["running", "pending"].includes(selectedTask.status)
        ? "active"
        : taskNeedsAttention(selectedTask)
          ? "attention"
          : "history",
    );
  }

  const taskTypes = useMemo(() => {
    return Array.from(new Set(tasks.map((task) => task.type)))
      .sort()
      .map((type) => ({
        value: type,
        label: taskLabel(type),
      }));
  }, [tasks, taskCatalog]);

  const taskFamilies = useMemo(() => {
    return [
      { value: "repair", label: "Repair" },
      { value: "acquisition", label: "Acquisition" },
      { value: "analysis", label: "Analysis" },
      { value: "sync", label: "Sync" },
      { value: "enrichment", label: "Enrichment" },
      { value: "other", label: "Other" },
    ];
  }, []);

  const activeTasks = useMemo(() => {
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const snapshotTasks = [
      ...(live?.running_tasks ?? []),
      ...(live?.pending_tasks ?? []),
    ];

    return snapshotTasks.map((task) => {
      const existing = taskMap.get(task.id);
      if (existing) return existing;
      return {
        id: task.id,
        type: task.type,
        status: task.status || "pending",
        progress: task.progress,
        error: null,
        params: null,
        result: null,
        priority: null,
        pool: task.pool ?? null,
        created_at:
          task.created_at ?? task.updated_at ?? new Date().toISOString(),
        started_at: task.started_at ?? null,
        updated_at:
          task.updated_at ?? task.created_at ?? new Date().toISOString(),
      } satisfies Task;
    });
  }, [live, tasks]);

  const completedTasks = useMemo(
    () =>
      tasks.filter(
        (task) => task.status !== "running" && task.status !== "pending",
      ),
    [tasks],
  );

  const recentQueueTasks = useMemo(
    () =>
      [...tasks]
        .filter((task) =>
          ["completed", "failed", "cancelled"].includes(task.status),
        )
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        ),
    [tasks],
  );

  const needsAttentionTasks = useMemo(
    () =>
      completedTasks
        .filter((task) => taskNeedsAttention(task))
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        ),
    [completedTasks],
  );
  const recentRepairTasks = useMemo(
    () =>
      completedTasks
        .filter((task) => isRepairTask(task))
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        ),
    [completedTasks],
  );

  useEffect(() => {
    const currentActiveIds = new Set(activeTasks.map((task) => task.id));
    const completedById = new Map(
      completedTasks.map((task) => [task.id, task]),
    );
    const nextHighlights: Array<{ id: string; status: string }> = [];
    const highlightedTask = searchParams.get("task");

    for (const taskId of previousActiveIdsRef.current) {
      if (currentActiveIds.has(taskId)) continue;
      const settledTask = completedById.get(taskId);
      if (!settledTask) continue;
      nextHighlights.push({ id: taskId, status: settledTask.status });
      if (
        !highlightedTask &&
        isRepairTask(settledTask) &&
        taskNeedsAttention(settledTask)
      ) {
        setExpandedId(settledTask.id);
      }
    }

    if (nextHighlights.length > 0) {
      for (const item of nextHighlights) {
        const existingTimer = highlightTimersRef.current[item.id];
        if (existingTimer != null) {
          window.clearTimeout(existingTimer);
        }
        highlightTimersRef.current[item.id] = window.setTimeout(() => {
          setSettledHighlights((current) => {
            const updated = { ...current };
            delete updated[item.id];
            return updated;
          });
          delete highlightTimersRef.current[item.id];
        }, 8000);
      }
      setSettledHighlights((prev) => {
        const next = { ...prev };
        for (const item of nextHighlights) {
          next[item.id] = { status: item.status };
        }
        return next;
      });
    }

    previousActiveIdsRef.current = currentActiveIds;
  }, [activeTasks, completedTasks, searchParams]);

  useEffect(() => {
    if (searchParams.get("task")) return;
    if (autoExpandedRepairRef.current) return;
    const candidate = recentRepairTasks.find((task) =>
      taskNeedsAttention(task),
    );
    if (!candidate) return;
    autoExpandedRepairRef.current = true;
    setExpandedId((current) => current ?? candidate.id);
    setTaskTab("attention");
  }, [recentRepairTasks, searchParams]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(highlightTimersRef.current)) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const filteredHistory = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return completedTasks.filter((task) => {
      if (filterFamily !== "all" && taskFamily(task.type) !== filterFamily)
        return false;
      if (filterType !== "all" && task.type !== filterType) return false;
      if (filterStatus !== "all" && task.status !== filterStatus) {
        return false;
      }
      if (!normalized) return true;
      const haystack = `${getTaskLabel(task)} ${task.id} ${
        task.type
      } ${JSON.stringify(task.params || {})}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [completedTasks, filterFamily, filterStatus, filterType, search]);

  const filteredAttention = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return needsAttentionTasks.filter((task) => {
      if (filterFamily !== "all" && taskFamily(task.type) !== filterFamily)
        return false;
      if (filterType !== "all" && task.type !== filterType) return false;
      if (!normalized) return true;
      const haystack = `${getTaskLabel(task)} ${task.id} ${
        task.type
      } ${JSON.stringify(task.params || {})}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [filterFamily, filterType, needsAttentionTasks, search]);

  const visibleActive = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return activeTasks.filter((task) => {
      if (filterFamily !== "all" && taskFamily(task.type) !== filterFamily)
        return false;
      if (filterType !== "all" && task.type !== filterType) return false;
      if (!normalized) return true;
      const haystack = `${getTaskLabel(task)} ${task.id} ${
        task.type
      } ${JSON.stringify(task.params || {})}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [activeTasks, filterFamily, filterType, search]);

  if (loading && !tasksSnapshot) {
    return <LoadingState label="Loading tasks" className="py-16" />;
  }

  if (error && !tasksSnapshot) {
    return (
      <ErrorState
        message="Failed to load task orchestration"
        onRetry={() => void fetchSnapshot(true)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Tasks"
        description="Background orchestration for enrichment, analysis, sync, repair and acquisition jobs across the whole stack."
        actions={
          <PageHeaderActions label="Task page actions">
            <PageHeaderAction
              label="Refresh"
              onClick={() => void fetchSnapshot(true)}
            >
              <RefreshCw aria-hidden="true" />
            </PageHeaderAction>
          </PageHeaderActions>
        }
      >
        <OpsSnapshotStatus
          snapshot={tasksSnapshot?.snapshot}
          streamStatus={streamStatus}
        />
      </OpsPageHero>

      {error && tasksSnapshot ? (
        <OpsRefreshNotice
          message="Could not refresh task orchestration. Showing the last successful snapshot."
          onRetry={() => void fetchSnapshot(true)}
        />
      ) : null}

      <OpsPanel
        title="Worker runtime"
        titleTone="accent"
        description="Queue lanes, concurrency controls and resource pressure for background work."
      >
        <WorkerControlPanel
          engine={live?.engine || "dramatiq"}
          running={live?.running_tasks.length ?? 0}
          pending={live?.pending_tasks.length ?? 0}
          slotLimit={
            live?.admission_policy?.max_running ?? live?.worker_slots.max ?? 3
          }
          queueBreakdown={
            live?.queue_breakdown ?? {
              running: {
                fast: 0,
                default: 0,
                heavy: 0,
                maintenance: 0,
                playback: 0,
              },
              pending: {
                fast: 0,
                default: 0,
                heavy: 0,
                maintenance: 0,
                playback: 0,
              },
            }
          }
          dbHeavyGate={
            live?.db_heavy_gate ?? { active: 0, pending: 0, blocking: false }
          }
          activeTasks={(live?.running_tasks ?? []).map((task) => ({
            id: task.id,
            type: task.type,
            pool: task.pool,
          }))}
          runningTasks={live?.running_tasks ?? []}
          pendingTasks={live?.pending_tasks ?? []}
          doneTasks={recentQueueTasks}
          taskTransitions={taskTransitions}
          taskTypeCount={taskCatalog?.types.length}
          onTaskSelect={selectQueueTask}
          refreshTasks={fetchSnapshot}
        />
      </OpsPanel>

      <OpsPanel
        title="Task desk"
        titleTone="accent"
        description="Review live work, resolve failures and inspect recent task results."
        action={
          taskTab === "history" ? (
            <DropdownMenu>
              <TooltipHint content="Task cleanup actions">
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-label="Task cleanup actions"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipHint>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => void cleanStatus("completed")}
                >
                  Clean completed tasks
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void cleanStatus("failed")}>
                  Clean failed tasks
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void cleanStatus("cancelled")}
                >
                  Clean cancelled tasks
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void cleanupOlder()}>
                  Clean tasks older than 7 days
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      >
        <Tabs
          value={taskTab}
          onValueChange={(value) => setTaskTab(value as typeof taskTab)}
          className="gap-5"
        >
          <TabsList aria-label="Task views">
            <TabsTrigger value="active">Active &amp; queued</TabsTrigger>
            <TabsTrigger value="attention">Needs attention</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(180px,0.8fr)_minmax(200px,1fr)]">
            <SearchInput
              label="Search tasks"
              containerClassName="min-w-0 md:col-span-2 lg:col-span-1"
              value={search}
              onValueChange={setSearch}
              placeholder="Search labels, ids or params..."
            />
            <AdminSelect
              ariaLabel="Task family"
              value={filterFamily}
              onChange={setFilterFamily}
              options={[
                { value: "all", label: "All families" },
                ...taskFamilies,
              ]}
              placeholder="All families"
              allowClear={false}
              triggerClassName="w-full min-w-0 max-w-none"
            />
            <AdminSelect
              value={filterType === "all" ? "" : filterType}
              onChange={(value) => setFilterType(value || "all")}
              options={taskTypes}
              placeholder="All task types"
              searchable
              searchPlaceholder="Filter task types..."
              triggerClassName="w-full min-w-0 max-w-none"
            />
            {taskTab === "history" ? (
              <div
                role="group"
                aria-label="Filter task outcomes"
                className="flex min-w-0 flex-wrap gap-2 md:col-span-2 lg:col-span-3"
              >
                {[
                  { value: "all", label: "All outcomes" },
                  { value: "completed", label: "Completed" },
                  { value: "failed", label: "Failed" },
                  { value: "cancelled", label: "Cancelled" },
                ].map((option) => (
                  <FilterChip
                    key={option.value}
                    active={filterStatus === option.value}
                    onClick={() => setFilterStatus(option.value)}
                  >
                    {option.label}
                  </FilterChip>
                ))}
              </div>
            ) : null}
          </div>

          <TabsContent value="active" className="mt-0">
            {visibleActive.length > 0 ? (
              <div className="divide-y divide-border-quiet">
                {visibleActive.map((task) => (
                  <ActiveTaskCard
                    key={task.id}
                    task={task}
                    expanded={expandedId === task.id}
                    onExpand={() =>
                      setExpandedId((current) =>
                        current === task.id ? null : task.id,
                      )
                    }
                    onCancel={() => setCancelId(task.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No active tasks match the current filters." />
            )}
          </TabsContent>

          <TabsContent value="attention" className="mt-0">
            {filteredAttention.length > 0 ? (
              <div className="divide-y divide-border-quiet">
                {filteredAttention.map((task) => (
                  <HistoryTaskRow
                    key={`attention-${task.id}`}
                    task={task}
                    expanded={expandedId === task.id}
                    onToggle={() =>
                      setExpandedId((current) =>
                        current === task.id ? null : task.id,
                      )
                    }
                    onRetry={() => handleRetry(task)}
                    highlightStatus={settledHighlights[task.id]?.status ?? null}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No tasks need attention right now." />
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            {filteredHistory.length > 0 ? (
              <div className="divide-y divide-border-quiet">
                {filteredHistory.map((task) => (
                  <HistoryTaskRow
                    key={task.id}
                    task={task}
                    expanded={expandedId === task.id}
                    onToggle={() =>
                      setExpandedId((current) =>
                        current === task.id ? null : task.id,
                      )
                    }
                    onRetry={() => handleRetry(task)}
                    highlightStatus={settledHighlights[task.id]?.status ?? null}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No historical tasks match the current filters." />
            )}
          </TabsContent>
        </Tabs>
      </OpsPanel>

      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelId(null);
        }}
        title="Cancel task"
        description="Cancel this background task? Running jobs may stop mid-operation depending on the worker handler."
        confirmLabel="Cancel task"
        tone="danger"
        onConfirm={async () => {
          if (cancelId) await handleCancel(cancelId);
        }}
        onError={() => toast.error("Failed to cancel task")}
        eyebrow="Confirm action"
        consequence={`Task ${
          cancelId ?? ""
        } · requests cancellation from the worker`}
      />
    </div>
  );
}
