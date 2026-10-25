import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

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

function connectTaskEventStream(taskId: string, stream: TaskEventStreamEntry) {
  if (stream.source || stream.state.done || stream.subscribers === 0) return;

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
    if (stream.reconnectTimer !== null) {
      window.clearTimeout(stream.reconnectTimer);
      stream.reconnectTimer = null;
    }
    source.close();
    if (stream.source === source) stream.source = null;
  });
}

function subscribeToTaskEventStream(
  taskId: string,
  stream: TaskEventStreamEntry,
  listener: () => void,
) {
  stream.listeners.add(listener);
  stream.subscribers += 1;
  if (stream.subscribers === 1) connectTaskEventStream(taskId, stream);

  return () => {
    stream.listeners.delete(listener);
    stream.subscribers = Math.max(0, stream.subscribers - 1);
    if (stream.subscribers !== 0) return;

    stream.source?.close();
    stream.source = null;
    if (stream.reconnectTimer !== null) {
      window.clearTimeout(stream.reconnectTimer);
      stream.reconnectTimer = null;
    }
    stream.state = EMPTY_TASK_EVENT_STATE;

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
 */
export function useTaskEvents(taskId: string | null) {
  const stream = useMemo(
    () => (taskId ? getTaskEventStream(taskId) : null),
    [taskId],
  );
  const subscribe = useCallback(
    (listener: () => void) =>
      taskId && stream
        ? subscribeToTaskEventStream(taskId, stream, listener)
        : () => undefined,
    [stream, taskId],
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
