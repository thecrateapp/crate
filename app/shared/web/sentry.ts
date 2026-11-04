export interface SentryScope {
  setTag(key: string, value: string): void;
  setContext(key: string, value: Record<string, unknown>): void;
  setFingerprint(fingerprint: string[]): void;
}

export interface SentryBreadcrumbLike {
  category?: string;
  type?: string;
  level?: "warning" | "info";
  message?: string;
  data?: Record<string, unknown>;
}

export interface SentryApi {
  addBreadcrumb(breadcrumb: SentryBreadcrumbLike): void;
  captureException(error: Error): void;
  withScope(callback: (scope: SentryScope) => void): void;
}

export interface SentryEventHintLike {
  originalException?: unknown;
}

export interface SentryFrameLike {
  filename?: string;
  abs_path?: string;
  in_app?: boolean;
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
      type?: string;
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

/**
 * Statuses that mean "the API is not reachable right now" rather than "this
 * request hit a bug": gateway errors during deploys and restarts, plus the
 * Cloudflare origin-unreachable family seen in front of the API (520-524).
 * They group into one `api-unavailable` issue per app instead of one issue per
 * call site. HTTP 500 is deliberately absent: it can be a real bug.
 */
const API_UNAVAILABLE_STATUSES = new Set([
  502, 503, 504, 520, 521, 522, 523, 524,
]);

export const API_UNAVAILABLE_FINGERPRINT = ["api-unavailable"];

export function isApiUnavailableStatus(status: number | undefined): boolean {
  return status !== undefined && API_UNAVAILABLE_STATUSES.has(status);
}

/**
 * `fetch` rejects with these TypeErrors when the request never got an HTTP
 * response (offline, DNS, TLS, connection reset, CORS preflight). Chrome says
 * "Failed to fetch", Safari "Load failed", Firefox "NetworkError when
 * attempting to fetch resource.". The Sentry browser SDK appends the request
 * host in place, e.g. "Failed to fetch (api.lespedants.org)".
 */
const FETCH_NETWORK_FAILURE =
  /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)(?: \([^()]*\))?$/;
/** The native HTTP client (reqwest, behind the Tauri HTTP plugin) rejects with this text. */
const NATIVE_HTTP_FAILURE = /^error sending request for url \(/;
const ABORT_ERROR_TEXT = /^AbortError(?::|$)/;

/**
 * True when a request failed before any HTTP response arrived. These are
 * connectivity problems on the client, not application errors: keep them as
 * breadcrumbs and never send them as Sentry error events. Generic TypeErrors
 * do not match.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof error === "string") return NATIVE_HTTP_FAILURE.test(error);
  const { name, message } = errorParts(error);
  if (message === undefined) return false;
  if (name === "TypeError") return FETCH_NETWORK_FAILURE.test(message);
  return NATIVE_HTTP_FAILURE.test(message);
}

/**
 * True for an intentional cancellation: a DOMException named AbortError, or the
 * stackless form the SDK reports from WebKit, an `Error` whose message starts
 * with "AbortError:".
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error === "string") return ABORT_ERROR_TEXT.test(error);
  const { name, message } = errorParts(error);
  if (name === "AbortError") return true;
  return message !== undefined && ABORT_ERROR_TEXT.test(message);
}

/**
 * Shared drop rule for every app's `beforeSend`. It looks at the error that
 * was captured and at the top-level exception of the event (the last value),
 * never at chained causes, so a real error that wraps a network failure is
 * still reported.
 */
export function shouldDropSentryEvent(
  event: SentryEventLike,
  hint?: SentryEventHintLike,
): boolean {
  const original = hint?.originalException;
  if (
    original !== undefined &&
    (isNetworkFailure(original) || isAbortError(original))
  ) {
    return true;
  }

  const values = event.exception?.values;
  const top = values?.[values.length - 1];
  if (!top?.value && !top?.type) return false;
  const value = top.value ?? "";
  if (top.type === "AbortError" || ABORT_ERROR_TEXT.test(value)) return true;
  if (top.type === "TypeError") return FETCH_NETWORK_FAILURE.test(value);
  return NATIVE_HTTP_FAILURE.test(value);
}

export interface SentryBeforeSendOptions {
  /** Drop every event while this returns true (e.g. a reload is underway). */
  suppress?: () => boolean;
}

/** Builds the `beforeSend` both apps use: drop noise, then scrub. */
export function createSentryBeforeSend(options: SentryBeforeSendOptions = {}) {
  return <T extends SentryEventLike>(
    event: T,
    hint?: SentryEventHintLike,
  ): T | null => {
    if (options.suppress?.()) return null;
    if (shouldDropSentryEvent(event, hint)) return null;
    return scrubSentryEvent(event);
  };
}

export function createApiErrorReporter(sentry: SentryApi) {
  return (error: unknown, context: SentryApiErrorContext): void => {
    if (isAbortError(error)) return;
    if (context.status === undefined && isNetworkFailure(error)) {
      sentry.addBreadcrumb({
        category: "api-client",
        type: "http",
        level: "warning",
        message: "API request failed before a response (network failure)",
        data: {
          method: context.method,
          url: safeRequestPath(context.url),
          reason: errorParts(error).message ?? String(error),
        },
      });
      return;
    }
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
      if (isApiUnavailableStatus(context.status)) {
        scope.setFingerprint(API_UNAVAILABLE_FINGERPRINT);
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

export interface SentryLocationLike {
  protocol: string;
  hostname: string;
  host: string;
}

/** The origin the app's own bundle is served from, scheme included. */
export function sentryAppOrigin(location: SentryLocationLike): string {
  return `${location.protocol}//${location.host}`;
}

/**
 * RewriteFrames iteratee that gives the app's own bundle files one stable
 * `app:///` path in every runtime: the public origin, a LAN install,
 * Capacitor (`capacitor://localhost`, `https://localhost`) and Tauri
 * (`tauri://localhost`, `http://tauri.localhost`). RewriteFrames runs before
 * the SDK writes `debug_meta`, so debug-ID source-map lookup keeps matching the
 * rewritten paths; the uploaded artifacts (`~/assets/...`) match `app:///assets/...`
 * too. Frames from other origins (third-party scripts) are left alone. It also
 * keeps the Capacitor SDK's rule that `[native code]` frames are not in-app,
 * because it replaces that SDK's default RewriteFrames integration.
 */
export function createSentryFrameNormalizer(appOrigin: string) {
  const origin = appOrigin.replace(/\/+$/, "").toLowerCase();
  return <F extends SentryFrameLike>(frame: F): F => {
    if (frame.filename === "[native code]" || frame.filename === "native") {
      frame.in_app = false;
      return frame;
    }
    const filename = appFramePath(frame.filename, origin);
    if (filename) frame.filename = filename;
    const absPath = appFramePath(frame.abs_path, origin);
    if (absPath) frame.abs_path = absPath;
    return frame;
  };
}

function appFramePath(
  value: string | undefined,
  origin: string,
): string | null {
  if (!value || !origin) return null;
  if (value.slice(0, origin.length).toLowerCase() !== origin) return null;
  const rest = value.slice(origin.length);
  // "http://host:80" must not match "http://host:8080/...".
  if (rest && !rest.startsWith("/")) return null;
  return `app://${rest.split(/[?#]/, 1)[0] || "/"}`;
}

/**
 * The Sentry environment for this page, or null when Sentry must stay off.
 *
 * A `production` build served over plain http from a loopback or
 * private-network host is a local or home install of a published image (for
 * example CRATE-ADMIN-4, from http://192.168.x.x:8580), not the hosted
 * production, which is always https. Those events are not actionable and
 * belong to someone else's install, so they are not sent at all. A build that
 * sets a different environment explicitly keeps reporting, which is how a
 * local smoke test opts in. Native shells are unaffected: Capacitor uses
 * `capacitor://` or `https://localhost`, Tauri `tauri://localhost` or
 * `http://tauri.localhost`, none of which match.
 */
export function resolveSentryEnvironment(
  configured: string | undefined,
  location?: Pick<SentryLocationLike, "protocol" | "hostname">,
): string | null {
  const environment = configured?.trim() || "development";
  if (
    environment === "production" &&
    location &&
    isLocalNetworkHttpOrigin(location)
  ) {
    return null;
  }
  return environment;
}

export function isLocalNetworkHttpOrigin(
  location: Pick<SentryLocationLike, "protocol" | "hostname">,
): boolean {
  if (location.protocol !== "http:") return false;
  const host = location.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local")) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    return (
      a === 127 || // loopback
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) || // link-local
      (a === 100 && b >= 64 && b <= 127) // shared address space (CGNAT, Tailscale)
    );
  }

  return (
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(host) || // unique local fc00::/7
    /^fe[89ab][0-9a-f]:/.test(host) // link-local fe80::/10
  );
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

function errorParts(error: unknown): { name?: string; message?: string } {
  if (!error || typeof error !== "object") return {};
  const { name, message } = error as { name?: unknown; message?: unknown };
  return {
    name: typeof name === "string" ? name : undefined,
    message: typeof message === "string" ? message : undefined,
  };
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
  return Array.isArray(value) ? value : (value.values ?? []);
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
