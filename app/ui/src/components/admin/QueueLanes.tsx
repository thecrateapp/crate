import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { cn } from "@/lib/utils";
import { taskLabel } from "@/lib/task-catalog";

export const QUEUE_LANE_ORDER = [
  "maintenance",
  "default",
  "fast",
  "heavy",
  "playback",
] as const;

export type QueueLaneName = (typeof QUEUE_LANE_ORDER)[number];
export type QueueLaneCounts = Record<QueueLaneName, number>;

export interface QueueLaneTask {
  id: string;
  type: string;
  pool?: string | null;
  status?: string | null;
  progress?: unknown;
  created_at?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
}

export interface QueueLaneTransition extends QueueLaneTask {
  sequence: number;
}

interface QueueLaneOverride {
  task: QueueLaneTask;
  terminalTask?: QueueLaneTask;
  holdUntil?: number;
  receivedAt: number;
}

const MIN_RUNNING_VISIBILITY_MS = 800;
const STALE_TRANSITION_RECONCILE_MS = 5000;
const EMPTY_TRANSITIONS: QueueLaneTransition[] = [];
const EMPTY_TASKS: QueueLaneTask[] = [];

function timestampAtLeast(
  candidate?: string | null,
  reference?: string | null,
) {
  if (!candidate || !reference) return false;
  const candidateTime = Date.parse(candidate);
  const referenceTime = Date.parse(reference);
  return (
    Number.isFinite(candidateTime) &&
    Number.isFinite(referenceTime) &&
    candidateTime >= referenceTime
  );
}

export interface QueueLaneBreakdown {
  running: QueueLaneCounts;
  pending: QueueLaneCounts;
}

const LANE_WORKERS: Record<QueueLaneName, string> = {
  maintenance: "maintenance-worker ×1",
  default: "worker ×3",
  fast: "worker ×3 · fast-worker ×2",
  heavy: "analysis-worker",
  playback: "playback-worker",
};

const GOVERNED_TASK_TYPES = new Set([
  "backfill_track_audio_fingerprints",
  "backfill_smart_mix_profiles",
  "backfill_artwork_variants",
  "cleanup_artwork_variants",
  "batch_covers",
  "batch_retag",
  "compute_analytics",
  "compute_smart_mix_profile",
  "compute_popularity",
  "enrich_mbids",
  "export_rich_metadata",
  "fetch_artwork_all",
  "fix_artist",
  "fix_issues",
  "generate_cast_spectrum",
  "health_check",
  "quality_check",
  "agent_maintenance",
  "show_extract",
  "library_pipeline",
  "library_sync",
  "materialize_artwork_variants",
  "migrate_storage_v2",
  "process_new_content",
  "rebuild_library",
  "rehydrate_portable_metadata",
  "repair",
  "prepare_library_repairs",
  "repair_artwork_variants",
  "resolve_duplicates",
  "scan",
  "scan_missing_covers",
  "verify_storage_v2",
  "wipe_library",
  "write_portable_metadata",
  "warmup_stream_variants",
]);

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function laneFor(pool?: string | null): QueueLaneName {
  return QUEUE_LANE_ORDER.includes(pool as QueueLaneName)
    ? (pool as QueueLaneName)
    : "default";
}

function tasksForLane(tasks: QueueLaneTask[], lane: QueueLaneName) {
  return tasks.filter((task) => laneFor(task.pool) === lane);
}

function progressPercent(progress: unknown): number | null {
  let value = progress;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const percent =
    typeof record.percent === "number"
      ? record.percent
      : typeof record.done === "number" && typeof record.total === "number"
        ? record.total > 0
          ? (record.done / record.total) * 100
          : null
        : null;
  return percent == null || !Number.isFinite(percent)
    ? null
    : Math.min(100, Math.max(0, percent));
}

function isDeferred(task: QueueLaneTask) {
  if (task.status !== "pending") return false;
  const progress = task.progress;
  const message =
    typeof progress === "string"
      ? progress
      : progress && typeof progress === "object"
        ? JSON.stringify(progress)
        : "";
  return /deferred by resource governor|paused by resource governor/i.test(
    message,
  );
}

function TaskChip({
  task,
  lane,
  state,
  onSelect,
  left,
  widthClass,
}: {
  task: QueueLaneTask;
  lane: QueueLaneName;
  state: "queued" | "running" | "done";
  onSelect?: (taskId: string) => void;
  left: string;
  widthClass: string;
}) {
  const deferred = isDeferred(task);
  const progress = state === "running" ? progressPercent(task.progress) : null;
  const doneStatus = task.status === "failed" ? "failed" : "done";
  const title = `${task.type} · ${taskLabel(task.type)} · ${doneStatus === "failed" && state === "done" ? "failed" : state} · ${lane}`;
  const className = cn(
    "absolute top-[19px] z-10 inline-flex h-5 min-w-0 items-center overflow-hidden rounded-full border px-2 font-mono text-[9px] leading-none text-text-primary transition-[left,background-color,border-color] duration-700 ease-out motion-reduce:transition-none",
    widthClass,
    state === "done"
      ? "border-border-quiet bg-transparent text-text-subtle"
      : "border-accent-action-hi/50 bg-accent-action-hi/10",
    GOVERNED_TASK_TYPES.has(task.type) && "border-dashed",
    deferred &&
      "border-dashed border-state-warning-text/80 text-state-warning-text",
    task.status === "failed" &&
      state === "done" &&
      "border-state-warning/60 text-state-warning-text",
  );
  const style = {
    left,
    background:
      state === "running" && progress != null
        ? `linear-gradient(90deg, color-mix(in srgb, var(--accent-action-hi) 30%, transparent) ${progress}%, transparent ${progress}%)`
        : undefined,
  } as CSSProperties;
  const content = (
    <>
      <span className="truncate">{task.type}</span>
      {deferred ? (
        <span className="sr-only">Waiting on resource governor</span>
      ) : null}
    </>
  );

  return (
    <TooltipHint content={title}>
      {onSelect ? (
        <button
          type="button"
          className={cn(
            className,
            "cursor-pointer hover:text-accent-action-hi focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-action-hi",
          )}
          style={style}
          data-queue-state={state}
          data-queue-task-id={task.id}
          aria-label={`Open ${taskLabel(task.type)} task details · ${state}`}
          onClick={() => onSelect(task.id)}
        >
          {content}
        </button>
      ) : (
        <span
          className={className}
          style={style}
          data-queue-state={state}
          data-queue-task-id={task.id}
          role="img"
          tabIndex={0}
          aria-label={`${taskLabel(task.type)} · ${state}`}
        >
          {content}
        </span>
      )}
    </TooltipHint>
  );
}

function QueueTrack({
  lane,
  queuedTasks,
  runningTasks,
  doneTasks,
  queuedCount,
  runningCount,
  doneCount,
  onTaskSelect,
}: {
  lane: QueueLaneName;
  queuedTasks: QueueLaneTask[];
  runningTasks: QueueLaneTask[];
  doneTasks: QueueLaneTask[];
  queuedCount: number;
  runningCount: number;
  doneCount: number;
  onTaskSelect?: (taskId: string) => void;
}) {
  const laneTasks = [
    ...queuedTasks.slice(0, 2).map((task, index) => ({
      task,
      state: "queued" as const,
      left: index === 0 ? "2%" : "18%",
      widthClass:
        index === 0
          ? "w-[14%] max-[499px]:w-[29%]"
          : "w-[14%] max-[499px]:hidden",
    })),
    ...runningTasks.slice(0, 2).map((task, index) => ({
      task,
      state: "running" as const,
      left: index === 0 ? "36%" : "58%",
      widthClass:
        index === 0
          ? "w-[21%] max-[499px]:w-[47%]"
          : "w-[21%] max-[499px]:hidden",
    })),
    ...doneTasks.slice(0, 1).map((task) => ({
      task,
      state: "done" as const,
      left: "86%",
      widthClass: "w-[13%]",
    })),
  ];
  const activeIds = new Set([
    ...queuedTasks.map((task) => task.id),
    ...runningTasks.map((task) => task.id),
  ]);
  const dedupedTasks = laneTasks.filter(({ task, state }) => {
    if (state === "done") return !activeIds.has(task.id);
    return true;
  });
  const queuedOverflow = Math.max(
    0,
    queuedCount - queuedTasks.slice(0, 2).length,
  );
  const runningOverflow = Math.max(
    0,
    runningCount - runningTasks.slice(0, 2).length,
  );
  const doneOverflow = Math.max(0, doneCount - doneTasks.slice(0, 1).length);

  return (
    <div
      role="group"
      aria-label={`${lane} task flow`}
      className="relative grid min-h-12 min-w-0 grid-cols-[34fr_50fr_16fr] overflow-hidden rounded-md border border-border-quiet bg-panel-surface"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid grid-cols-[34fr_50fr_16fr]"
      >
        {[
          { label: "queued", className: "border-r border-border-quiet/70" },
          { label: "running", className: "border-r border-border-quiet/70" },
          { label: "done", className: "" },
        ].map(({ label, className }) => (
          <span
            key={label}
            className={cn(
              "min-w-0 overflow-hidden px-1.5 pt-1 font-mono text-[8px] uppercase tracking-[0.14em] text-text-subtle",
              className,
            )}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="absolute inset-0">
        {dedupedTasks.map(({ task, state, left, widthClass }) => (
          <TaskChip
            key={task.id}
            task={task}
            lane={lane}
            state={state}
            left={left}
            widthClass={widthClass}
            onSelect={onTaskSelect}
          />
        ))}
        {queuedOverflow > 0 ? (
          <span className="absolute left-[31%] top-[23px] font-mono text-[9px] text-text-muted max-[499px]:hidden">
            +{queuedOverflow}
          </span>
        ) : null}
        {runningOverflow > 0 ? (
          <span className="absolute left-[80%] top-[23px] font-mono text-[9px] text-text-muted max-[499px]:hidden">
            +{runningOverflow}
          </span>
        ) : null}
        {doneOverflow > 0 ? (
          <span className="absolute left-[98%] top-[23px] -translate-x-full font-mono text-[8px] text-text-muted max-[499px]:hidden">
            +{doneOverflow}
          </span>
        ) : null}
        {queuedTasks.length === 0 && queuedCount === 0 ? (
          <span className="absolute left-2 top-[23px] font-mono text-[9px] text-text-subtle">
            —
          </span>
        ) : null}
        {runningTasks.length === 0 && runningCount === 0 ? (
          <span className="absolute left-[36%] top-[23px] font-mono text-[9px] text-text-subtle">
            —
          </span>
        ) : null}
        {doneTasks.length === 0 && doneCount === 0 ? (
          <span className="absolute left-[86%] top-[23px] font-mono text-[9px] text-text-subtle">
            —
          </span>
        ) : null}
      </div>
      <span className="sr-only">
        {queuedCount} queued, {runningCount} running, {doneCount} recently done
      </span>
    </div>
  );
}

export function QueueLanes({
  breakdown,
  runningTasks,
  pendingTasks,
  doneTasks = EMPTY_TASKS,
  transitions = EMPTY_TRANSITIONS,
  taskTypeCount,
  onTaskSelect,
  className,
}: {
  breakdown: QueueLaneBreakdown;
  runningTasks: QueueLaneTask[];
  pendingTasks: QueueLaneTask[];
  doneTasks?: QueueLaneTask[];
  transitions?: QueueLaneTransition[];
  taskTypeCount?: number;
  onTaskSelect?: (taskId: string) => void;
  className?: string;
}) {
  const motionAllowed = useMotionAllowed();
  const terminalTasks = useMemo(
    () => doneTasks.filter((task) => TERMINAL_STATUSES.has(task.status ?? "")),
    [doneTasks],
  );
  const snapshotTasksById = useMemo(() => {
    const tasks = new Map<string, QueueLaneTask>();
    pendingTasks.forEach((task) =>
      tasks.set(task.id, { ...task, status: task.status ?? "pending" }),
    );
    runningTasks.forEach((task) =>
      tasks.set(task.id, { ...task, status: task.status ?? "running" }),
    );
    terminalTasks.forEach((task) => tasks.set(task.id, task));
    return tasks;
  }, [doneTasks, pendingTasks, runningTasks, terminalTasks]);
  const [overrides, setOverrides] = useState<Record<string, QueueLaneOverride>>(
    {},
  );
  const overridesRef = useRef(overrides);
  const lastSequenceRef = useRef(0);
  const runningSinceRef = useRef(new Map<string, number>());
  const timersRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (transitions.length === 0) return;
    const unseen = transitions
      .filter((transition) => transition.sequence > lastSequenceRef.current)
      .sort((a, b) => a.sequence - b.sequence);
    if (unseen.length === 0) return;

    const next = { ...overridesRef.current };
    for (const transition of unseen) {
      lastSequenceRef.current = Math.max(
        lastSequenceRef.current,
        transition.sequence,
      );
      const snapshotTask = snapshotTasksById.get(transition.id);
      const previous = next[transition.id];
      const baseTask = previous?.terminalTask ?? previous?.task ?? snapshotTask;
      const task = { ...baseTask, ...transition };
      const status = transition.status ?? "";
      const receivedAt = Date.now();
      const oldTimer = timersRef.current.get(transition.id);
      if (oldTimer != null) {
        window.clearTimeout(oldTimer);
        timersRef.current.delete(transition.id);
      }

      if (["running", "delegated", "completing"].includes(status)) {
        if (!runningSinceRef.current.has(transition.id)) {
          runningSinceRef.current.set(transition.id, Date.now());
        }
        next[transition.id] = {
          task: { ...task, status: "running" },
          receivedAt,
        };
        continue;
      }

      if (TERMINAL_STATUSES.has(status)) {
        const previousStatus = previous?.task.status ?? snapshotTask?.status;
        const hasStarted =
          runningSinceRef.current.has(transition.id) ||
          Boolean(task.started_at) ||
          ["running", "delegated", "completing"].includes(previousStatus ?? "");
        const runningSince =
          runningSinceRef.current.get(transition.id) ?? Date.now();
        const remaining = motionAllowed
          ? Math.max(0, MIN_RUNNING_VISIBILITY_MS - (Date.now() - runningSince))
          : 0;

        if (hasStarted && remaining > 0) {
          const holdUntil = Date.now() + remaining;
          const terminalTask = { ...task, status };
          next[transition.id] = {
            task: { ...terminalTask, status: "running" },
            terminalTask,
            holdUntil,
            receivedAt,
          };
          const taskId = transition.id;
          const timer = window.setTimeout(() => {
            const settled = { ...overridesRef.current };
            const current = settled[taskId];
            if (current?.terminalTask !== terminalTask) return;
            settled[taskId] = { task: terminalTask, receivedAt: Date.now() };
            overridesRef.current = settled;
            setOverrides(settled);
            runningSinceRef.current.delete(taskId);
            timersRef.current.delete(taskId);
          }, remaining);
          timersRef.current.set(taskId, timer);
        } else {
          next[transition.id] = { task: { ...task, status }, receivedAt };
          runningSinceRef.current.delete(transition.id);
        }
        continue;
      }

      if (status === "pending") {
        runningSinceRef.current.delete(transition.id);
        next[transition.id] = { task: { ...task, status }, receivedAt };
      }
    }

    overridesRef.current = next;
    setOverrides(next);
  }, [motionAllowed, snapshotTasksById, transitions]);

  useEffect(() => {
    if (motionAllowed) return;
    const next = { ...overridesRef.current };
    let changed = false;
    for (const [taskId, override] of Object.entries(next)) {
      if (override.terminalTask == null) continue;
      const timer = timersRef.current.get(taskId);
      if (timer != null) window.clearTimeout(timer);
      timersRef.current.delete(taskId);
      runningSinceRef.current.delete(taskId);
      next[taskId] = {
        task: override.terminalTask,
        receivedAt: Date.now(),
      };
      changed = true;
    }
    if (!changed) return;
    overridesRef.current = next;
    setOverrides(next);
  }, [motionAllowed]);

  useEffect(() => {
    const next = { ...overridesRef.current };
    let changed = false;
    for (const [taskId, override] of Object.entries(next)) {
      if (override.holdUntil != null && override.holdUntil > Date.now())
        continue;
      const snapshotTask = snapshotTasksById.get(taskId);
      const snapshotMatchesTransition =
        snapshotTask != null &&
        snapshotTask.status === override.task.status &&
        timestampAtLeast(snapshotTask.updated_at, override.task.updated_at);
      const snapshotMovedPastTransition =
        snapshotTask &&
        timestampAtLeast(snapshotTask.updated_at, override.task.updated_at) &&
        Date.now() - override.receivedAt >= STALE_TRANSITION_RECONCILE_MS;
      if (snapshotMatchesTransition || snapshotMovedPastTransition) {
        delete next[taskId];
        changed = true;
      }
    }
    if (changed) {
      overridesRef.current = next;
      setOverrides(next);
    }
  }, [snapshotTasksById]);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    },
    [],
  );

  const visibleTasksById = new Map(snapshotTasksById);
  for (const [taskId, override] of Object.entries(overrides)) {
    visibleTasksById.set(taskId, {
      ...visibleTasksById.get(taskId),
      ...override.task,
    });
  }
  const visibleTasks = Array.from(visibleTasksById.values());
  const queuedTasks = visibleTasks.filter((task) => task.status === "pending");
  const activeTasks = visibleTasks.filter((task) =>
    ["running", "delegated", "completing"].includes(task.status ?? ""),
  );
  const visibleTerminalTasks = visibleTasks.filter((task) =>
    TERMINAL_STATUSES.has(task.status ?? ""),
  );
  const visibleBreakdown = {
    running: { ...breakdown.running },
    pending: { ...breakdown.pending },
  };
  for (const [taskId, override] of Object.entries(overrides)) {
    const source = snapshotTasksById.get(taskId);
    const destination = visibleTasksById.get(taskId) ?? override.task;
    if (!source || laneFor(source.pool) !== laneFor(destination.pool)) continue;
    const lane = laneFor(source.pool);
    if (source.status === "pending") {
      visibleBreakdown.pending[lane] = Math.max(
        0,
        visibleBreakdown.pending[lane] - 1,
      );
    } else if (
      ["running", "delegated", "completing"].includes(source.status ?? "")
    ) {
      visibleBreakdown.running[lane] = Math.max(
        0,
        visibleBreakdown.running[lane] - 1,
      );
    }
    if (destination.status === "pending") {
      visibleBreakdown.pending[lane] += 1;
    } else if (
      ["running", "delegated", "completing"].includes(destination.status ?? "")
    ) {
      visibleBreakdown.running[lane] += 1;
    }
  }

  return (
    <figure
      role="region"
      aria-label="Worker queue lanes"
      className={cn("m-0 min-w-0 border-t border-border-quiet pt-5", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
          <MonoLabel as="span" tone="accent" size="eyebrow">
            Operations
          </MonoLabel>
          <span>
            {taskTypeCount == null ? "—" : taskTypeCount.toLocaleString()} task
            types · five queues
          </span>
        </p>
        <p className="m-0 inline-flex items-center font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted">
          <span
            aria-hidden="true"
            className="mr-2 inline-block h-[9px] w-[18px] rounded-full border border-dashed border-state-warning-text/70"
          />
          governed by the resource governor
        </p>
      </header>

      <ol className="my-5 list-none border-y border-border-quiet p-0">
        {QUEUE_LANE_ORDER.map((lane) => {
          const running = visibleBreakdown.running[lane] ?? 0;
          const queued = visibleBreakdown.pending[lane] ?? 0;
          const laneRunning = tasksForLane(activeTasks, lane);
          const laneQueued = tasksForLane(queuedTasks, lane);
          const laneDone = tasksForLane(visibleTerminalTasks, lane);
          const latestDone = laneDone.slice(0, 1);

          return (
            <li
              key={lane}
              data-testid={`queue-lane-${lane}`}
              aria-label={`${lane} queue`}
              className="grid min-w-0 grid-cols-[minmax(130px,2fr)_minmax(0,9fr)] items-center gap-6 border-b border-border-quiet py-3 last:border-b-0 max-[760px]:grid-cols-[auto_minmax(0,1fr)] max-[760px]:gap-x-3 max-[760px]:gap-y-2"
            >
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 max-[760px]:col-span-2 max-[760px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:gap-x-2">
                <MonoLabel
                  as="span"
                  tone="accent"
                  size="eyebrow"
                  className="truncate"
                >
                  {lane}
                </MonoLabel>
                <span
                  data-testid="queue-total-count"
                  className="row-span-3 self-center translate-y-0.5 font-mono text-[clamp(1.7rem,3vw,2.65rem)] font-extrabold leading-none tracking-[-0.045em] tabular-nums text-text-primary max-[760px]:hidden"
                >
                  {running + queued}
                </span>
                <span className="truncate font-mono text-[9px] text-text-muted max-[760px]:col-start-2 max-[760px]:row-start-1 max-[760px]:justify-self-end">
                  {LANE_WORKERS[lane]}
                </span>
                <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-text-subtle max-[760px]:col-span-2">
                  {running} running · {queued} queued
                </span>
              </div>

              <div className="min-w-0 max-[760px]:col-start-2 max-[760px]:row-start-2">
                <QueueTrack
                  lane={lane}
                  queuedTasks={laneQueued}
                  runningTasks={laneRunning}
                  doneTasks={latestDone}
                  queuedCount={queued}
                  runningCount={running}
                  doneCount={laneDone.length}
                  onTaskSelect={onTaskSelect}
                />
              </div>
              <span
                data-testid="queue-total-count-mobile"
                aria-hidden="true"
                className="hidden self-center font-mono text-[1.6rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums text-text-primary max-[760px]:col-start-1 max-[760px]:row-start-2 max-[760px]:block"
              >
                {running + queued}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
