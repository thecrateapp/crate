import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import {
  AUTH_SESSION_REJECTED_EVENT,
  apiUrl,
  ensureFreshAuthToken,
  getApiAuthHeaders,
  getApiBase,
} from "@/lib/api";
import {
  isAndroidBrowser,
  isAndroidNative,
  isIosBrowser,
  isIosNative,
} from "@/lib/capacitor-runtime";
import { isTauriRuntime, usesConfigurableServer } from "@/lib/platform";
import type { ConcretePlaybackDeliveryPolicy } from "@/lib/playback-network-quality";
import {
  createPlaybackQoeStore,
  type PlaybackQoeSendResult,
} from "@/lib/playback-qoe-store";
import { getCurrentServerId } from "@/lib/server-store";

export type PlaybackQoeEventName =
  | "startup"
  | "stall_start"
  | "stall_end"
  | "recovery"
  | "intent"
  | "result"
  | "active"
  | "continuation";
export type PlaybackQoeOutcome = "started" | "failed" | "cancelled";
export type PlaybackQoeFailureCause =
  | "network"
  | "decode"
  | "auth"
  | "unavailable"
  | "timeout"
  | "other";
export type PlaybackQoeOrigin = "local" | "remote" | "imported";
export type PlaybackQoeRuntime =
  | "desktop_web"
  | "mobile_web"
  | "android_native"
  | "ios_native"
  | "tauri";
export type PlaybackQoeEngine = "gapless" | "media3";
export type PlaybackContinuationOutcome =
  | "recovered"
  | "unavailable"
  | "exhausted"
  | "cancelled"
  | "native"
  | "auth";
export type PlaybackContinuationSurface = "radio" | "infinite";

export interface PlaybackQoeInput {
  event: PlaybackQoeEventName;
  origin?: PlaybackQoeOrigin;
  requestedPolicy?: ConcretePlaybackDeliveryPolicy;
  effectivePolicy?: ConcretePlaybackDeliveryPolicy;
  durationMs?: number;
  bufferedAheadSeconds?: number;
  attempt?: number;
  runtime?: PlaybackQoeRuntime;
  engine?: PlaybackQoeEngine;
  outcome?: PlaybackQoeOutcome;
  cause?: PlaybackQoeFailureCause;
  continuation?: PlaybackContinuationOutcome;
  surface?: PlaybackContinuationSurface;
}

export interface PlaybackQoeEvent {
  event: PlaybackQoeEventName;
  origin?: PlaybackQoeOrigin;
  requested_policy?: ConcretePlaybackDeliveryPolicy;
  effective_policy?: ConcretePlaybackDeliveryPolicy;
  duration_ms?: number;
  buffered_ahead_seconds?: number;
  attempt?: number;
  runtime?: PlaybackQoeRuntime;
  engine?: PlaybackQoeEngine;
  outcome?: PlaybackQoeOutcome;
  cause?: PlaybackQoeFailureCause;
  continuation?: PlaybackContinuationOutcome;
  surface?: PlaybackContinuationSurface;
}

const QOE_PATH = "/api/playback/qoe";
const REQUEST_TIMEOUT_MS = 5_000;

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
  return [
    "startup",
    "stall_start",
    "stall_end",
    "recovery",
    "intent",
    "result",
    "active",
    "continuation",
  ].includes(String(value));
}

function isOutcome(value: unknown): value is PlaybackQoeOutcome {
  return ["started", "failed", "cancelled"].includes(String(value));
}

function isFailureCause(value: unknown): value is PlaybackQoeFailureCause {
  return [
    "network",
    "decode",
    "auth",
    "unavailable",
    "timeout",
    "other",
  ].includes(String(value));
}

function isContinuationOutcome(
  value: unknown,
): value is PlaybackContinuationOutcome {
  return [
    "recovered",
    "unavailable",
    "exhausted",
    "cancelled",
    "native",
    "auth",
  ].includes(String(value));
}

function isContinuationSurface(
  value: unknown,
): value is PlaybackContinuationSurface {
  return ["radio", "infinite"].includes(String(value));
}

function isOrigin(value: unknown): value is PlaybackQoeOrigin {
  return ["local", "remote", "imported"].includes(String(value));
}

function isConcretePolicy(
  value: unknown,
): value is ConcretePlaybackDeliveryPolicy {
  return ["original", "balanced", "data_saver"].includes(String(value));
}

function isRuntime(value: unknown): value is PlaybackQoeRuntime {
  return [
    "desktop_web",
    "mobile_web",
    "android_native",
    "ios_native",
    "tauri",
  ].includes(String(value));
}

function isEngine(value: unknown): value is PlaybackQoeEngine {
  return ["gapless", "media3"].includes(String(value));
}

export function getPlaybackQoeRuntime(): PlaybackQoeRuntime {
  if (isAndroidNative) return "android_native";
  if (isIosNative) return "ios_native";
  if (isTauriRuntime) return "tauri";
  if (isAndroidBrowser || isIosBrowser) return "mobile_web";
  return "desktop_web";
}

/** Shape telemetry explicitly, discarding every identifier and network hint. */
export function shapePlaybackQoeEvent(
  input: PlaybackQoeInput | Record<string, unknown>,
): PlaybackQoeEvent | null {
  if (input.event === "continuation") return shapeContinuationEvent(input);
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
  if (isRuntime(input.runtime)) event.runtime = input.runtime;
  if (isEngine(input.engine)) event.engine = input.engine;
  if (event.event === "result") {
    if (!isOutcome(input.outcome)) return null;
    event.outcome = input.outcome;
    if (input.outcome === "failed" && isFailureCause(input.cause)) {
      event.cause = input.cause;
    }
  }
  if (event.event === "active" && event.duration_ms === undefined) return null;
  return event;
}

function shapeContinuationEvent(
  input: PlaybackQoeInput | Record<string, unknown>,
): PlaybackQoeEvent | null {
  if (
    !isContinuationOutcome(input.continuation) ||
    !isContinuationSurface(input.surface)
  ) {
    return null;
  }
  const event: PlaybackQoeEvent = {
    event: "continuation",
    continuation: input.continuation,
    surface: input.surface,
  };
  const durationMs = boundedNumber(input.durationMs, 0, 600_000, true);
  if (durationMs !== undefined) event.duration_ms = durationMs;
  if (isRuntime(input.runtime)) event.runtime = input.runtime;
  return event;
}

function createId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 3_600);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.min(Math.max(0, (at - Date.now()) / 1_000), 3_600);
}

async function sendBatch(body: string): Promise<PlaybackQoeSendResult> {
  if (usesConfigurableServer) {
    await ensureFreshAuthToken().catch(() => false);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(QOE_PATH), {
      method: "POST",
      headers: { ...getApiAuthHeaders(), "Content-Type": "application/json" },
      body,
      credentials: usesConfigurableServer ? "omit" : "include",
      keepalive: true,
      signal: controller.signal,
    });
    return {
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("Retry-After")),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sendOnUnload(body: string): boolean {
  if (
    getApiBase() !== "" ||
    typeof navigator === "undefined" ||
    typeof navigator.sendBeacon !== "function"
  ) {
    return false;
  }
  return navigator.sendBeacon(
    QOE_PATH,
    new Blob([body], { type: "application/json" }),
  );
}

const store = createPlaybackQoeStore<PlaybackQoeEvent>({
  now: () => Date.now(),
  createId,
  getScope: () => `${getApiBase()}|${getCurrentServerId() ?? "web"}`,
  send: sendBatch,
  sendOnUnload,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});

export function recordPlaybackQoe(
  input: PlaybackQoeInput | Record<string, unknown>,
): void {
  const event = shapePlaybackQoeEvent(input);
  if (event) store.record(event);
}

export function flushPlaybackQoe(): void {
  void store.flush();
}

export function clearPlaybackQoe(): void {
  store.clear();
}

export function getPlaybackQoeDeliverySnapshot() {
  return store.snapshot();
}

export function installPlaybackQoeFlush(): () => void {
  if (typeof window === "undefined") return () => {};
  const flush = () => store.flushOnUnload();
  const clear = () => store.clear();
  window.addEventListener("pagehide", flush);
  window.addEventListener(AUTH_RUNTIME_RESET_EVENT, clear);
  window.addEventListener(AUTH_SESSION_REJECTED_EVENT, clear);
  return () => {
    window.removeEventListener("pagehide", flush);
    window.removeEventListener(AUTH_RUNTIME_RESET_EVENT, clear);
    window.removeEventListener(AUTH_SESSION_REJECTED_EVENT, clear);
  };
}

export function __resetPlaybackQoeForTests(): void {
  store.clear();
}
