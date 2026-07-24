import { apiFetch, getApiBase } from "@/lib/api";
import type { ConcretePlaybackDeliveryPolicy } from "@/lib/playback-network-quality";

export type PlaybackQoeEventName =
  | "startup"
  | "stall_start"
  | "stall_end"
  | "recovery";
export type PlaybackQoeOrigin = "local" | "remote" | "imported";

export interface PlaybackQoeInput {
  event: PlaybackQoeEventName;
  origin: PlaybackQoeOrigin;
  requestedPolicy: ConcretePlaybackDeliveryPolicy;
  effectivePolicy: ConcretePlaybackDeliveryPolicy;
  durationMs?: number;
  bufferedAheadSeconds?: number;
  attempt?: number;
}

export interface PlaybackQoeEvent {
  event: PlaybackQoeEventName;
  origin: PlaybackQoeOrigin;
  requested_policy: ConcretePlaybackDeliveryPolicy;
  effective_policy: ConcretePlaybackDeliveryPolicy;
  duration_ms?: number;
  buffered_ahead_seconds?: number;
  attempt?: number;
}

const MAX_EVENTS_PER_SESSION = 24;
const MAX_BATCH_SIZE = 12;
const FLUSH_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 2_000;

let events: PlaybackQoeEvent[] = [];
let flushTimer: number | null = null;
let recordedEventCount = 0;

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = integer ? Math.trunc(value) : value;
  return normalized >= minimum && normalized <= maximum
    ? normalized
    : undefined;
}

function isEventName(value: unknown): value is PlaybackQoeEventName {
  return ["startup", "stall_start", "stall_end", "recovery"].includes(
    String(value),
  );
}

function isOrigin(value: unknown): value is PlaybackQoeOrigin {
  return ["local", "remote", "imported"].includes(String(value));
}

function isConcretePolicy(
  value: unknown,
): value is ConcretePlaybackDeliveryPolicy {
  return ["original", "balanced", "data_saver"].includes(String(value));
}

/** Shape telemetry explicitly, discarding every identifier and network hint. */
export function shapePlaybackQoeEvent(
  input: PlaybackQoeInput | Record<string, unknown>,
): PlaybackQoeEvent | null {
  if (
    !isEventName(input.event) ||
    !isOrigin(input.origin) ||
    !isConcretePolicy(input.requestedPolicy) ||
    !isConcretePolicy(input.effectivePolicy)
  ) {
    return null;
  }

  const event: PlaybackQoeEvent = {
    event: input.event,
    origin: input.origin,
    requested_policy: input.requestedPolicy,
    effective_policy: input.effectivePolicy,
  };
  const durationMs = boundedNumber(input.durationMs, 0, 600_000, true);
  const bufferedAheadSeconds = boundedNumber(
    input.bufferedAheadSeconds,
    0,
    7_200,
  );
  const attempt = boundedNumber(input.attempt, 1, 3, true);
  if (durationMs !== undefined) event.duration_ms = durationMs;
  if (bufferedAheadSeconds !== undefined) {
    event.buffered_ahead_seconds = bufferedAheadSeconds;
  }
  if (attempt !== undefined) event.attempt = attempt;
  return event;
}

function clearFlushTimer(): void {
  if (flushTimer === null) return;
  window.clearTimeout(flushTimer);
  flushTimer = null;
}

function sendBatch(batch: PlaybackQoeEvent[]): void {
  const body = JSON.stringify({ events: batch });
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function" &&
    getApiBase() === ""
  ) {
    const payload = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/playback/qoe", payload)) return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  void apiFetch("/api/playback/qoe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => window.clearTimeout(timeout));
}

/** Queue an intentionally tiny, non-blocking telemetry event. */
export function recordPlaybackQoe(
  input: PlaybackQoeInput | Record<string, unknown>,
): void {
  const event = shapePlaybackQoeEvent(input);
  if (!event || recordedEventCount >= MAX_EVENTS_PER_SESSION) return;
  events.push(event);
  recordedEventCount += 1;
  if (events.length >= MAX_BATCH_SIZE) {
    flushPlaybackQoe();
    return;
  }
  if (flushTimer === null && typeof window !== "undefined") {
    flushTimer = window.setTimeout(flushPlaybackQoe, FLUSH_DELAY_MS);
  }
}

export function flushPlaybackQoe(): void {
  if (events.length === 0) return;
  clearFlushTimer();
  const pending = events;
  events = [];
  for (let index = 0; index < pending.length; index += MAX_BATCH_SIZE) {
    sendBatch(pending.slice(index, index + MAX_BATCH_SIZE));
  }
}

export function installPlaybackQoeFlush(): () => void {
  if (typeof window === "undefined") return () => {};
  const flush = () => flushPlaybackQoe();
  window.addEventListener("pagehide", flush);
  return () => window.removeEventListener("pagehide", flush);
}

export function __resetPlaybackQoeForTests(): void {
  events = [];
  recordedEventCount = 0;
  clearFlushTimer();
}
