/**
 * Local retry queue for play-event writes.
 *
 * When `apiFetch` fails (auth expired, server down, offline), these
 * events are best-effort — losing them silently erodes stats/scrobble
 * fidelity. We persist failed events to localStorage and retry with
 * exponential backoff on mount, on `online`, and periodically.
 *
 * Rules:
 *  - max queue size: 500 events (circular, oldest dropped first)
 *  - max retries per event: 5
 *  - backoff: 2s, 4s, 8s, 16s, 32s (capped at 60s)
 *  - single in-flight flush at a time to avoid duplicate deliveries
 *  - events are persisted before their first POST, so a process killed
 *    mid-request still delivers them; the server deduplicates by
 *    client_event_id
 */
import { apiFetch } from "@/lib/api";

export const PENDING_PLAY_EVENTS_STORAGE_KEY = "listen-pending-play-events:v1";
const LEGACY_PENDING_PLAY_EVENTS_STORAGE_KEY = "listen-pending-play-events";
const MAX_QUEUE_SIZE = 500;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;
// Keeps the periodic flush from resending an event whose first POST is
// still in flight.
const FIRST_SEND_GRACE_MS = 30000;

interface QueuedEvent {
  id: string;
  endpoint: string;
  payload: unknown;
  queuedAt: string;
  attempts: number;
  nextRetryAt: string;
}

function generateId(): string {
  // Small random id; no need for crypto-grade uniqueness, just dedup in
  // local state. Time-based component keeps ordering sensible on inspect.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readQueue(): QueuedEvent[] {
  try {
    const currentRaw = localStorage.getItem(PENDING_PLAY_EVENTS_STORAGE_KEY);
    const legacyRaw = localStorage.getItem(
      LEGACY_PENDING_PLAY_EVENTS_STORAGE_KEY,
    );
    const current = currentRaw ? JSON.parse(currentRaw) : [];
    const legacy = legacyRaw ? JSON.parse(legacyRaw) : [];
    const currentEvents: QueuedEvent[] = Array.isArray(current) ? current : [];
    const legacyEvents: QueuedEvent[] = Array.isArray(legacy) ? legacy : [];
    if (!legacyRaw) return currentEvents;

    const seen = new Set<string>();
    const migrated = [...legacyEvents, ...currentEvents]
      .filter((event) => {
        if (!event || typeof event.id !== "string" || seen.has(event.id)) {
          return false;
        }
        seen.add(event.id);
        return true;
      })
      .slice(-MAX_QUEUE_SIZE);
    writeQueue(migrated);
    localStorage.removeItem(LEGACY_PENDING_PLAY_EVENTS_STORAGE_KEY);
    return migrated;
  } catch {
    return [];
  }
}

function writeQueue(events: QueuedEvent[]): void {
  try {
    localStorage.setItem(
      PENDING_PLAY_EVENTS_STORAGE_KEY,
      JSON.stringify(events),
    );
  } catch {
    /* quota exceeded or storage disabled — drop silently */
  }
}

function backoffFor(attempts: number): number {
  const ms = RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(ms, RETRY_MAX_MS);
}

let flushInFlight = false;

/**
 * Enqueue a failed API write for later retry. Oldest entries are dropped
 * when the queue exceeds MAX_QUEUE_SIZE.
 */
export function enqueueEvent(
  endpoint: string,
  payload: unknown,
  delayMs = 0,
): string {
  const now = new Date();
  const event: QueuedEvent = {
    id: generateId(),
    endpoint,
    payload,
    queuedAt: now.toISOString(),
    attempts: 0,
    // Send on the next flush; backoff only applies after an actual
    // delivery attempt fails.
    nextRetryAt: new Date(now.getTime() + delayMs).toISOString(),
  };
  const queue = readQueue();
  queue.push(event);
  // Trim oldest if over capacity.
  while (queue.length > MAX_QUEUE_SIZE) {
    queue.shift();
  }
  writeQueue(queue);
  return event.id;
}

function removeQueuedEvent(id: string): void {
  const queue = readQueue();
  const remaining = queue.filter((event) => event.id !== id);
  if (remaining.length !== queue.length) writeQueue(remaining);
}

function makeQueuedEventDue(id: string): void {
  const now = new Date().toISOString();
  writeQueue(
    readQueue().map((event) =>
      event.id === id ? { ...event, nextRetryAt: now } : event,
    ),
  );
}

/**
 * Attempt to resend every queued event whose nextRetryAt has passed.
 * Returns counts for observability. Skipped if another flush is in
 * flight (concurrent calls coalesce).
 */
export async function flushQueue(): Promise<{
  sent: number;
  failed: number;
  dropped: number;
}> {
  if (flushInFlight) return { sent: 0, failed: 0, dropped: 0 };
  flushInFlight = true;
  try {
    const queue = readQueue();
    if (queue.length === 0) return { sent: 0, failed: 0, dropped: 0 };
    const flushedIds = new Set(queue.map((event) => event.id));

    const now = Date.now();
    let sent = 0;
    let failed = 0;
    let dropped = 0;
    const remaining: QueuedEvent[] = [];

    for (const event of queue) {
      const dueAt = Date.parse(event.nextRetryAt);
      if (!Number.isNaN(dueAt) && dueAt > now) {
        // Not yet due.
        remaining.push(event);
        continue;
      }

      try {
        // Replay order is part of the queue contract; requests are retried in order.
        // react-doctor-disable-next-line async-await-in-loop
        const response = await apiFetch(event.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(event.payload),
        });
        if (response && (response.ok || response.status === 204)) {
          sent += 1;
          continue;
        }
        // 401 is an auth issue, not a request issue. Preserve the event
        // untouched (no attempt counter bump, no backoff) so we don't
        // burn the retry budget while the user is signed out or before
        // auth has hydrated. It'll re-flush once auth becomes ready.
        if (response && response.status === 401) {
          failed += 1;
          remaining.push(event);
          continue;
        }
        // Other 4xx — malformed payload / missing resource → unrecoverable.
        if (response && response.status >= 400 && response.status < 500) {
          dropped += 1;
          continue;
        }
        throw new Error(`HTTP ${response?.status ?? "unknown"}`);
      } catch {
        const attempts = event.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          dropped += 1;
          continue;
        }
        failed += 1;
        remaining.push({
          ...event,
          attempts,
          nextRetryAt: new Date(
            Date.now() + backoffFor(attempts),
          ).toISOString(),
        });
      }
    }

    // Keep events persisted by postWithRetry while this flush was sending.
    const addedDuringFlush = readQueue().filter(
      (event) => !flushedIds.has(event.id),
    );
    writeQueue([...remaining, ...addedDuringFlush].slice(-MAX_QUEUE_SIZE));
    return { sent, failed, dropped };
  } finally {
    flushInFlight = false;
  }
}

export function queueSize(): number {
  return readQueue().length;
}

/**
 * Discard every queued event. Call on logout / account switch so
 * telemetry from the previous user doesn't flush under another user's
 * authenticated session.
 */
export function clearQueue(): void {
  try {
    localStorage.removeItem(PENDING_PLAY_EVENTS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PENDING_PLAY_EVENTS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * POST with automatic retry-on-failure. The payload is persisted before
 * the request and removed once the server accepts it or rejects it as
 * unrecoverable (4xx other than 401). Network errors, 5xx and 401 leave
 * it queued for the next flush.
 *
 * Fire-and-forget; never throws.
 */
export async function postWithRetry(
  endpoint: string,
  payload: unknown,
): Promise<void> {
  const id = enqueueEvent(endpoint, payload, FIRST_SEND_GRACE_MS);
  try {
    const response = await apiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (response.ok || response.status === 204) {
      removeQueuedEvent(id);
      return;
    }

    // 4xx non-401 → request is shaped wrong / resource invalid; don't retry.
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 401
    ) {
      removeQueuedEvent(id);
      console.warn(`[${endpoint}] rejected ${response.status}`, payload);
      return;
    }

    // 401 (token expired) + 5xx → retry on the next flush.
    makeQueuedEventDue(id);
  } catch (err) {
    // Network error, timeout, etc.
    makeQueuedEventDue(id);
    console.warn(`[${endpoint}] network error, queued`, err);
  }
}
