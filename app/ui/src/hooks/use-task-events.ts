import { useState, useEffect, useRef, useCallback } from "react";

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

/**
 * Hook that connects to a task's SSE stream and accumulates events.
 * Returns events array + done status. Auto-closes when task completes.
 */
export function useTaskEvents(taskId: string | null) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [done, setDone] = useState<TaskDone | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    setEvents([]);
    setDone(null);
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!taskId) {
      reset();
      return;
    }

    reset();
    const source = new EventSource(`/api/events/task/${taskId}?generic=1`);
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.addEventListener("task_event", (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        const fallbackType =
          isRecord(payload) && typeof payload.event_type === "string"
            ? payload.event_type
            : "info";
        setEvents((prev) => {
          const next = [...prev, normalizeTaskEvent(payload, fallbackType)];
          return next.length > 200 ? next.slice(-200) : next;
        });
      } catch {
        // Ignore parse errors
      }
    });

    // Task completion
    source.addEventListener("task_done", (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setDone(payload);
      } catch {
        setDone({ status: "completed" });
      }
      source.close();
      setConnected(false);
    });

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [taskId, reset]);

  return { events, done, connected, reset };
}
