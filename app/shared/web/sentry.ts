export interface SentryScope {
  setTag(key: string, value: string): void;
  setContext(key: string, value: Record<string, unknown>): void;
}

export interface SentryApi {
  captureException(error: Error): void;
  withScope(callback: (scope: SentryScope) => void): void;
}

export interface SentryEventLike {
  request?: {
    url?: string;
    method?: string;
    data?: unknown;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
  };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  exception?: {
    values?: Array<{
      value?: string;
      stacktrace?: SentryStackTraceLike;
      raw_stacktrace?: SentryStackTraceLike;
    }>;
  };
  stacktrace?: SentryStackTraceLike;
  threads?: SentryValuesLike<{ stacktrace?: SentryStackTraceLike }>;
  breadcrumbs?: SentryValuesLike<{
    message?: string;
    data?: Record<string, unknown>;
  }>;
}

type SentryValuesLike<T> = T[] | { values?: T[] };

interface SentryStackTraceLike {
  frames?: Array<{ filename?: string; abs_path?: string }>;
}

export interface SentryApiErrorContext {
  method: string;
  url: string;
  status?: number;
}

const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "secret",
  "token",
  "verifier",
  "session_key",
  "oauth_code",
  "media_ticket",
  "state",
  "code",
] as const;

export function createApiErrorReporter(sentry: SentryApi) {
  return (error: unknown, context: SentryApiErrorContext): void => {
    if (isAbortError(error)) return;
    if (
      context.status !== undefined &&
      context.status < 500 &&
      context.status !== 429
    ) {
      return;
    }

    const report =
      context.status === undefined
        ? error instanceof Error
          ? error
          : new Error(String(error))
        : new Error(`API request failed with HTTP ${context.status}`);
    sentry.withScope((scope) => {
      scope.setTag("error.source", "api-client");
      scope.setTag("http.method", context.method);
      if (context.status !== undefined) {
        scope.setTag("http.status_code", String(context.status));
      }
      scope.setContext("request", {
        method: context.method,
        url: safeRequestPath(context.url),
        ...(context.status === undefined ? {} : { status: context.status }),
      });
      sentry.captureException(report);
    });
  };
}

export function safeRequestPath(value: string): string {
  try {
    return new URL(value, window.location.origin).pathname;
  } catch {
    return value.split("?", 1)[0] || "/";
  }
}

export function scrubSentryEvent<T extends SentryEventLike>(event: T): T {
  if (event.request) {
    event.request = {
      ...event.request,
      url: event.request.url ? safeRequestPath(event.request.url) : undefined,
      data: undefined,
      query_string: undefined,
      cookies: undefined,
      headers: scrubHeaders(event.request.headers),
    };
  }
  if (event.user) {
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  }
  if (event.message) event.message = scrubText(event.message);
  if (event.logentry?.message) {
    event.logentry.message = scrubText(event.logentry.message);
  }
  if (event.logentry?.params) {
    event.logentry.params = event.logentry.params.map(scrubValue);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
    if (exception.stacktrace) scrubStackTrace(exception.stacktrace);
    if (exception.raw_stacktrace) scrubStackTrace(exception.raw_stacktrace);
  }
  if (event.stacktrace) scrubStackTrace(event.stacktrace);
  for (const thread of collectionValues(event.threads)) {
    if (thread.stacktrace) scrubStackTrace(thread.stacktrace);
  }
  for (const breadcrumb of collectionValues(event.breadcrumbs)) {
    if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
    if (breadcrumb.data) breadcrumb.data = scrubMap(breadcrumb.data);
  }
  if (event.extra) event.extra = scrubMap(event.extra);
  if (event.contexts) event.contexts = scrubMap(event.contexts);
  if (event.tags) event.tags = scrubMap(event.tags);
  return event;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function scrubHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? "[Filtered]" : scrubText(value),
    ]),
  );
}

function scrubMap(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? "[Filtered]" : scrubValue(value),
    ]),
  );
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") {
    return scrubMap(value as Record<string, unknown>);
  }
  return value;
}

function scrubText(value: string): string {
  return value
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, "[FilteredCredential]")
    .replace(
      /(authorization|set-cookie|cookie|password|passwd|secret|(?:access|refresh|id)?[_ -]?token|oauth[_ -]?code|verifier|session[_ -]?key|\bcode|\bstate)\b(\s*[:=]\s*)(["']?)[^\s,;&"'<>]+/gi,
      "$1$2[Filtered]",
    )
    .replace(
      /(https?:\/\/[^\s"'<>?]+)\?(?!\[Filtered query\])[^\s"'<>]*/gi,
      "$1?[Filtered query]",
    )
    .replace(/\?(?!\[Filtered query\])[^\s"'<>]*/g, "?[Filtered query]")
    .replace(/\b(?:tauri|cratemusic):\/\/[^\s"'<>]*/gi, "[Filtered deep link]")
    .replace(/(?:\/Users\/|\/home\/)[^\s"'<>]*/g, "[Filtered path]")
    .replace(/\b[A-Z]:\\Users\\[^\s"'<>]*/gi, "[Filtered path]");
}

function scrubStackTrace(stacktrace: SentryStackTraceLike): void {
  for (const frame of stacktrace.frames ?? []) {
    if (frame.filename) frame.filename = scrubPersonalPath(frame.filename);
    if (frame.abs_path) frame.abs_path = scrubPersonalPath(frame.abs_path);
  }
}

function collectionValues<T>(value?: SentryValuesLike<T>): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.values ?? [];
}

function scrubPersonalPath(value: string): string {
  return value
    .replace(/(?:file:\/\/)?\/(?:Users|home)\/[^/]+/g, "$HOME")
    .replace(/\b[A-Z]:\\Users\\[^\\]+/gi, "$HOME");
}

function isSensitiveKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[- ]/g, "_");
  return SENSITIVE_KEYS.some((part) => normalized.includes(part));
}
