export type ReceiverMetricName =
  | "receiver.media_retry"
  | "receiver.media_skip"
  | "receiver.media_terminal"
  | "receiver.queue_conflict"
  | "receiver.queue_refresh"
  | "receiver.session_load"
  | "receiver.spectrum"
  | "receiver.startup";

export type ReceiverMetricAttributes = Record<
  string,
  boolean | number | string
>;

export interface ReceiverTelemetry {
  captureError(error: Error, stage: string): void;
  metric(name: ReceiverMetricName, attributes?: ReceiverMetricAttributes): void;
}

interface ReceiverSentryEvent {
  breadcrumbs?: Array<{
    data?: Record<string, unknown>;
    message?: string;
  }>;
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  request?: {
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, string>;
    query_string?: unknown;
    url?: string;
  };
  tags?: Record<string, unknown>;
  user?: Record<string, unknown>;
}

type SentryModule = typeof import("@sentry/react");

const FILTERED = "[Filtered]";
const RECEIVER_SESSION_PATH = /\/api\/cast\/sessions\/[^/?#\s]+/gi;
const SENSITIVE_KEY_PARTS = [
  "album",
  "artist",
  "authorization",
  "bootstrapurl",
  "cookie",
  "credential",
  "itemid",
  "lease",
  "password",
  "queue",
  "secret",
  "signed",
  "streamurl",
  "title",
  "token",
  "track",
  "url",
] as const;
const ALLOWED_METRIC_ATTRIBUTES = new Set([
  "attempt",
  "caf_version",
  "device_category",
  "outcome",
  "reason",
  "source",
]);

let initialized = false;
let initialization: Promise<void> | null = null;
let sentryModule: SentryModule | null = null;
let sentryModulePromise: Promise<SentryModule | null> | null = null;

export function sanitizeReceiverUrl(value: string): string {
  try {
    const url = new URL(
      value,
      globalThis.location?.origin ?? "https://receiver.invalid",
    );
    return redactReceiverSessionPath(url.pathname);
  } catch {
    return redactReceiverSessionPath(value.split(/[?#]/, 1)[0] || "/");
  }
}

export function scrubReceiverSentryEvent<T extends ReceiverSentryEvent>(
  event: T,
): T {
  if (event.request) {
    event.request = {
      ...event.request,
      url: event.request.url
        ? sanitizeReceiverUrl(event.request.url)
        : undefined,
      data: undefined,
      query_string: undefined,
      cookies: undefined,
      headers: scrubHeaders(event.request.headers),
    };
  }
  if (event.user) event.user = undefined;
  if (event.extra) event.extra = scrubRecord(event.extra);
  if (event.contexts) event.contexts = scrubRecord(event.contexts);
  if (event.tags) event.tags = scrubRecord(event.tags);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      ...(breadcrumb.message ? { message: scrubText(breadcrumb.message) } : {}),
      ...(breadcrumb.data ? { data: scrubRecord(breadcrumb.data) } : {}),
    }));
  }
  return event;
}

export function initReceiverSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (initialized || !dsn) return Promise.resolve();
  if (initialization) return initialization;

  initialization = loadSentry().then((sentry) => {
    if (!sentry || initialized) return;
    sentry.init({
      dsn,
      environment:
        import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || "development",
      release: import.meta.env.VITE_SENTRY_RELEASE?.trim() || undefined,
      sendDefaultPii: false,
      enableMetrics: true,
      tracesSampleRate: parseSampleRate(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
        0.05,
      ),
      beforeSend: scrubReceiverSentryEvent,
      beforeBreadcrumb: (breadcrumb) =>
        scrubReceiverSentryEvent({ breadcrumbs: [breadcrumb] })
          .breadcrumbs?.[0] ?? null,
    });
    sentryModule = sentry;
    initialized = true;
  });
  return initialization;
}

export function recordReceiverMetric(
  name: ReceiverMetricName,
  attributes: ReceiverMetricAttributes = {},
): void {
  const safeAttributes = Object.fromEntries(
    Object.entries(attributes).filter(([key]) =>
      ALLOWED_METRIC_ATTRIBUTES.has(key),
    ),
  );
  if (sentryModule) {
    sentryModule.metrics.count(name, 1, { attributes: safeAttributes });
    return;
  }
  void withSentry((sentry) => {
    sentry.metrics.count(name, 1, { attributes: safeAttributes });
  });
}

export function captureReceiverError(error: Error, stage: string): void {
  if (sentryModule) {
    sentryModule.captureException(error, {
      tags: { stage: scrubText(stage) },
    });
    return;
  }
  void withSentry((sentry) => {
    sentry.captureException(error, {
      tags: { stage: scrubText(stage) },
    });
  });
}

export const receiverTelemetry: ReceiverTelemetry = {
  captureError: captureReceiverError,
  metric: recordReceiverMetric,
};

function loadSentry(): Promise<SentryModule | null> {
  return (sentryModulePromise ??= import("@sentry/react").catch(() => null));
}

function withSentry(callback: (sentry: SentryModule) => void): Promise<void> {
  return initReceiverSentry().then(() => {
    if (sentryModule) callback(sentryModule);
  });
}

function scrubRecord(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? FILTERED : scrubValue(value),
    ]),
  );
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") {
    return scrubRecord(value as Record<string, unknown>);
  }
  return typeof value === "string" ? scrubText(value) : value;
}

function scrubHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? FILTERED : scrubText(value),
    ]),
  );
}

function scrubText(value: string): string {
  const withoutUrls = value.replace(/https?:\/\/[^\s]+/gi, (url) =>
    sanitizeReceiverUrl(url),
  );
  return redactReceiverSessionPath(withoutUrls).split("?", 1)[0] ?? "";
}

function redactReceiverSessionPath(value: string): string {
  return value.replace(RECEIVER_SESSION_PATH, "/api/cast/sessions/[Filtered]");
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}
