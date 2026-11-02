export interface PlaybackQoeDeliveryCounts {
  dropped: number;
  expired: number;
  send_failed: number;
}

export interface PlaybackQoeSendResult {
  status: number;
  retryAfterSeconds?: number;
}

export interface PlaybackQoeStoreDependencies {
  now: () => number;
  createId: () => string;
  getScope: () => string;
  send: (body: string) => Promise<PlaybackQoeSendResult>;
  sendOnUnload?: (body: string) => boolean;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

interface StoredEvent<TEvent> {
  payload: TEvent & { event_id: string };
  queuedAt: number;
}

interface PendingBatch<TEvent> {
  batchId: string;
  events: StoredEvent<TEvent>[];
  attempts: number;
}

export const PLAYBACK_QOE_LIMITS = {
  batchSize: 12,
  bufferSize: 96,
  burst: 24,
  refillPerSecond: 0.5,
  eventTtlMs: 10 * 60_000,
  flushDelayMs: 1_000,
  maxAttempts: 3,
  retryBaseMs: 2_000,
  unauthorizedPauseMs: 60_000,
  defaultRetryAfterSeconds: 60,
} as const;

function emptyCounts(): PlaybackQoeDeliveryCounts {
  return { dropped: 0, expired: 0, send_failed: 0 };
}

export function createPlaybackQoeStore<TEvent extends object>(
  deps: PlaybackQoeStoreDependencies,
) {
  const limits = PLAYBACK_QOE_LIMITS;
  let buffer: StoredEvent<TEvent>[] = [];
  let pending: PendingBatch<TEvent> | null = null;
  let inFlight = false;
  let counts = emptyCounts();
  let tokens: number = limits.burst;
  let refilledAt = deps.now();
  let pausedUntil = 0;
  let timer: unknown = null;
  let timerDueAt = Number.POSITIVE_INFINITY;
  let generation = 0;
  let scope: string | null = null;

  function clearScheduled(): void {
    if (timer === null) return;
    deps.clearTimer(timer);
    timer = null;
    timerDueAt = Number.POSITIVE_INFINITY;
  }

  function schedule(delayMs: number): void {
    const dueAt = deps.now() + Math.max(0, delayMs);
    if (timer !== null && timerDueAt <= dueAt) return;
    clearScheduled();
    timerDueAt = dueAt;
    timer = deps.setTimer(() => {
      timer = null;
      timerDueAt = Number.POSITIVE_INFINITY;
      void flush();
    }, Math.max(0, delayMs));
  }

  function clear(): void {
    generation += 1;
    clearScheduled();
    buffer = [];
    pending = null;
    inFlight = false;
    counts = emptyCounts();
    tokens = limits.burst;
    refilledAt = deps.now();
    pausedUntil = 0;
    scope = null;
  }

  function ensureScope(): void {
    const current = deps.getScope();
    if (scope !== null && current !== scope) clear();
    scope = current;
  }

  function takeToken(): boolean {
    const now = deps.now();
    tokens = Math.min(
      limits.burst,
      tokens + ((now - refilledAt) / 1_000) * limits.refillPerSecond,
    );
    refilledAt = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  function expire(events: StoredEvent<TEvent>[]): StoredEvent<TEvent>[] {
    const oldest = deps.now() - limits.eventTtlMs;
    const fresh = events.filter((event) => event.queuedAt >= oldest);
    counts.expired += events.length - fresh.length;
    return fresh;
  }

  function nextBatch(): PendingBatch<TEvent> | null {
    if (pending) {
      const events = expire(pending.events);
      pending = events.length > 0 ? { ...pending, events } : null;
      if (pending) return pending;
    }
    buffer = expire(buffer);
    if (buffer.length === 0) return null;
    pending = {
      batchId: deps.createId(),
      events: buffer.splice(0, limits.batchSize),
      attempts: 0,
    };
    return pending;
  }

  function body(batch: PendingBatch<TEvent>, sent: PlaybackQoeDeliveryCounts) {
    const payload: Record<string, unknown> = {
      schema_version: 2,
      batch_id: batch.batchId,
      events: batch.events.map((event) => event.payload),
    };
    if (sent.dropped || sent.expired || sent.send_failed) {
      payload.delivery = sent;
    }
    return JSON.stringify(payload);
  }

  function settle(sent: PlaybackQoeDeliveryCounts): void {
    counts = {
      dropped: Math.max(0, counts.dropped - sent.dropped),
      expired: Math.max(0, counts.expired - sent.expired),
      send_failed: Math.max(0, counts.send_failed - sent.send_failed),
    };
  }

  function fail(batch: PendingBatch<TEvent>): void {
    counts.send_failed += batch.events.length;
    pending = null;
  }

  async function flush(): Promise<void> {
    ensureScope();
    if (inFlight) return;
    const now = deps.now();
    if (pausedUntil > now) {
      if (pending || buffer.length > 0) schedule(pausedUntil - now);
      return;
    }
    const batch = nextBatch();
    if (!batch) return;
    clearScheduled();
    const sent = { ...counts };
    const started = generation;
    inFlight = true;
    let result: PlaybackQoeSendResult;
    try {
      result = await deps.send(body(batch, sent));
    } catch {
      result = { status: 0 };
    }
    if (started !== generation) return;
    inFlight = false;

    if (result.status >= 200 && result.status < 300) {
      settle(sent);
      pending = null;
    } else if (result.status === 429) {
      pausedUntil =
        deps.now() +
        (result.retryAfterSeconds ?? limits.defaultRetryAfterSeconds) * 1_000;
    } else if (result.status === 401 || result.status === 403) {
      fail(batch);
      pausedUntil = deps.now() + limits.unauthorizedPauseMs;
    } else if (result.status >= 400 && result.status < 500) {
      fail(batch);
    } else {
      batch.attempts += 1;
      if (batch.attempts >= limits.maxAttempts) {
        fail(batch);
      } else {
        schedule(limits.retryBaseMs * 4 ** (batch.attempts - 1));
        return;
      }
    }
    if (pending || buffer.length > 0) schedule(0);
  }

  function record(payload: TEvent): void {
    ensureScope();
    if (
      !takeToken() ||
      buffer.length + (pending?.events.length ?? 0) >= limits.bufferSize
    ) {
      counts.dropped += 1;
      return;
    }
    buffer.push({
      payload: { ...payload, event_id: deps.createId() },
      queuedAt: deps.now(),
    });
    schedule(buffer.length >= limits.batchSize ? 0 : limits.flushDelayMs);
  }

  function flushOnUnload(): void {
    ensureScope();
    if (!deps.sendOnUnload || inFlight || pausedUntil > deps.now()) {
      void flush();
      return;
    }
    let batch = nextBatch();
    while (batch) {
      const sent = { ...counts };
      if (!deps.sendOnUnload(body(batch, sent))) {
        void flush();
        return;
      }
      settle(sent);
      pending = null;
      batch = nextBatch();
    }
    clearScheduled();
  }

  return {
    record,
    flush,
    flushOnUnload,
    clear,
    snapshot: () => ({
      buffered: buffer.length + (pending?.events.length ?? 0),
      delivery: { ...counts },
      pausedUntil,
    }),
  };
}

export type PlaybackQoeStore<TEvent extends object> = ReturnType<
  typeof createPlaybackQoeStore<TEvent>
>;
