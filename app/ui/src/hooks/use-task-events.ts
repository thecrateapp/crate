import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

export interface TaskEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface TaskDone {
  status: string;
  result?: Record<string, unknown>;
  error?: string;
}

interface TaskEventState {
  events: TaskEvent[];
  done: TaskDone | null;
  connected: boolean;
}

interface TaskEventStreamEntry {
  state: TaskEventState;
  source: EventSource | null;
  reconnectTimer: number | null;
  subscribers: number;
  listeners: Set<() => void>;
  /** Terminal status a consumer already knows, e.g. from the tasks snapshot. */
  knownTerminalStatus: string | null;
  /** Consumers that want the stored log of a task that already finished. */
  replaySubscribers: number;
  replayAttempted: boolean;
}

export interface UseTaskEventsOptions {
  /** The task's status as the caller last saw it. */
  status?: string | null;
  /**
   * For a task that already finished, open the stream once to read its stored
   * log. Without it, a finished task never opens a stream.
   */
  replayLog?: boolean;
}

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function isTerminalTaskStatus(
  status: string | null | undefined,
): status is string {
  return typeof status === "string" && TERMINAL_TASK_STATUSES.has(status);
}

const EMPTY_TASK_EVENT_STATE: TaskEventState = {
  events: [],
  done: null,
  connected: false,
};
const taskEventStreams = new Map<string, TaskEventStreamEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadData(payload: Record<string, unknown>) {
  if (isRecord(payload.data)) return payload.data;
  const data = Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !["id", "type", "timestamp"].includes(key),
    ),
  );
  return data;
}

export function normalizeTaskEvent(
  payload: unknown,
  fallbackType = "info",
): TaskEvent {
  const event = isRecord(payload) ? payload : {};
  const rawType = event.type;
  const type =
    typeof rawType === "string" && rawType.trim()
      ? rawType.trim()
      : fallbackType;
  const rawTimestamp = event.timestamp;
  const timestamp =
    typeof rawTimestamp === "string" && rawTimestamp.trim()
      ? rawTimestamp
      : new Date().toISOString();
  const rawId = event.id;
  const numericId =
    typeof rawId === "number" ? rawId : Number.parseInt(String(rawId), 10);

  return {
    id: Number.isFinite(numericId) ? numericId : 0,
    type,
    data: payloadData(event),
    timestamp,
  };
}

function getTaskEventStream(taskId: string) {
  let stream = taskEventStreams.get(taskId);
  if (!stream) {
    stream = {
      state: EMPTY_TASK_EVENT_STATE,
      source: null,
      reconnectTimer: null,
      subscribers: 0,
      listeners: new Set(),
      knownTerminalStatus: null,
      replaySubscribers: 0,
      replayAttempted: false,
    };
    taskEventStreams.set(taskId, stream);
  }
  return stream;
}

function publishTaskEventState(
  stream: TaskEventStreamEntry,
  update: (current: TaskEventState) => TaskEventState,
) {
  stream.state = update(stream.state);
  stream.listeners.forEach((listener) => listener());
}

function clearReconnect(stream: TaskEventStreamEntry) {
  if (stream.reconnectTimer === null) return;
  window.clearTimeout(stream.reconnectTimer);
  stream.reconnectTimer = null;
}

/** Report a task the client already knows is finished as done, without a stream. */
function settleKnownTerminalTask(stream: TaskEventStreamEntry) {
  clearReconnect(stream);
  const status = stream.knownTerminalStatus;
  if (!status || stream.state.done) return;
  publishTaskEventState(stream, (current) => ({
    ...current,
    done: { status },
    connected: false,
  }));
}

function noteTaskStatus(
  stream: TaskEventStreamEntry,
  status: string | null | undefined,
) {
  if (!isTerminalTaskStatus(status) || stream.knownTerminalStatus) return;
  stream.knownTerminalStatus = status;
  // An open stream ends itself with task_done, and its errors no longer
  // reconnect. A stream waiting to reconnect stops here.
  if (!stream.source && stream.subscribers > 0) settleKnownTerminalTask(stream);
}

function connectTaskEventStream(taskId: string, stream: TaskEventStreamEntry) {
  if (stream.source || stream.state.done || stream.subscribers === 0) return;
  if (stream.knownTerminalStatus) {
    if (stream.replaySubscribers === 0 || stream.replayAttempted) {
      settleKnownTerminalTask(stream);
      return;
    }
    stream.replayAttempted = true;
  }

  const source = new EventSource(`/api/events/task/${taskId}?generic=1`);
  stream.source = source;
  source.onopen = () => {
    if (stream.source !== source) return;
    publishTaskEventState(stream, (current) => ({
      ...current,
      connected: true,
    }));
  };
  source.onerror = () => {
    if (stream.source !== source) return;
    source.close();
    stream.source = null;
    publishTaskEventState(stream, (current) => ({
      ...current,
      connected: false,
    }));
    if (stream.knownTerminalStatus) {
      settleKnownTerminalTask(stream);
      return;
    }
    if (stream.reconnectTimer === null && stream.subscribers > 0) {
      stream.reconnectTimer = window.setTimeout(() => {
        stream.reconnectTimer = null;
        connectTaskEventStream(taskId, stream);
      }, 5000);
    }
  };

  source.addEventListener("task_event", (event: MessageEvent) => {
    if (stream.source !== source) return;
    try {
      const payload = JSON.parse(event.data);
      const fallbackType =
        isRecord(payload) && typeof payload.event_type === "string"
          ? payload.event_type
          : "info";
      const normalized = normalizeTaskEvent(payload, fallbackType);
      publishTaskEventState(stream, (current) => {
        if (
          normalized.id > 0 &&
          current.events.some((existing) => existing.id === normalized.id)
        )
          return current;
        const next = [...current.events, normalized];
        return {
          ...current,
          events: next.length > 200 ? next.slice(-200) : next,
        };
      });
    } catch {
      // Ignore parse errors.
    }
  });

  source.addEventListener("task_done", (event: MessageEvent) => {
    if (stream.source !== source) return;
    let done: TaskDone;
    try {
      done = JSON.parse(event.data) as TaskDone;
    } catch {
      done = { status: "completed" };
    }
    publishTaskEventState(stream, (current) => ({
      ...current,
      done,
      connected: false,
    }));
    clearReconnect(stream);
    source.close();
    if (stream.source === source) stream.source = null;
  });
}

function subscribeToTaskEventStream(
  taskId: string,
  stream: TaskEventStreamEntry,
  listener: () => void,
  replayLog: boolean,
) {
  stream.listeners.add(listener);
  stream.subscribers += 1;
  if (replayLog) stream.replaySubscribers += 1;
  if (stream.subscribers === 1) connectTaskEventStream(taskId, stream);

  return () => {
    stream.listeners.delete(listener);
    stream.subscribers = Math.max(0, stream.subscribers - 1);
    if (replayLog)
      stream.replaySubscribers = Math.max(0, stream.replaySubscribers - 1);
    if (stream.subscribers !== 0) return;

    stream.source?.close();
    stream.source = null;
    clearReconnect(stream);
    stream.state = EMPTY_TASK_EVENT_STATE;
    stream.replayAttempted = false;

    // React StrictMode briefly unsubscribes and resubscribes on mount. Delay
    // deleting the shared entry by one microtask so both subscriptions reuse it.
    queueMicrotask(() => {
      if (stream.subscribers === 0 && taskEventStreams.get(taskId) === stream) {
        taskEventStreams.delete(taskId);
      }
    });
  };
}

/**
 * Hook that shares one task SSE stream between every mounted consumer for the
 * same task ID. The connection closes when the task completes or the last
 * consumer unmounts.
 *
 * Pass the task's `status` when the caller knows it. A task already in a
 * terminal state opens no stream (or one, with `replayLog`, to read its stored
 * log) and is never reconnected.
 */
export function useTaskEvents(
  taskId: string | null,
  { status, replayLog = false }: UseTaskEventsOptions = {},
) {
  const stream = useMemo(
    () => (taskId ? getTaskEventStream(taskId) : null),
    [taskId],
  );
  // Declared before useSyncExternalStore so a status known at mount is
  // recorded before the subscription decides whether to open a stream.
  useEffect(() => {
    if (stream) noteTaskStatus(stream, status);
  }, [status, stream]);
  const subscribe = useCallback(
    (listener: () => void) =>
      taskId && stream
        ? subscribeToTaskEventStream(taskId, stream, listener, replayLog)
        : () => undefined,
    [replayLog, stream, taskId],
  );
  const getSnapshot = useCallback(
    () => stream?.state ?? EMPTY_TASK_EVENT_STATE,
    [stream],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [clearedState, setClearedState] = useState<TaskEventState | null>(null);
  const reset = useCallback(() => {
    setClearedState(stream?.state ?? null);
  }, [stream]);
  const visible = clearedState === state ? EMPTY_TASK_EVENT_STATE : state;

  return { ...visible, reset };
}
