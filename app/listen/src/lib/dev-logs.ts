export type DevLogLevel = "debug" | "info" | "warn" | "error";

export interface DevLogEntry {
  id: number;
  timestamp: number;
  level: DevLogLevel;
  scope: string;
  message: string;
  detail?: string;
}

export const DEV_LOG_EVENT = "crate:dev-log";
const DEV_LOG_STORAGE_KEY = "crate-dev-logs";
const DEV_LOG_FORCE_KEY = "crate-dev-logs-enabled";
const MAX_LOGS = 200;
const SENSITIVE_ASSIGNMENT =
  /\b(authorization|set-cookie|cookie|password|passwd|secret|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|token|media_ticket|session[_ -]?key|verifier|oauth[_ -]?code|code|state)(\s*[:=]\s*)(["']?)[^\s,;&"'<>]+/gi;
const QUERY_STRING = /\?(?!\[Filtered query\])[^#\s"'<>]+/g;
const BEARER_CREDENTIAL = /\b(?:Bearer|Basic)\s+[^\s,;]+/gi;
const DEEP_LINK = /\b(?:tauri|cratemusic):\/\/[^\s"'<>]*/gi;
const PERSONAL_PATH = /(?:\/Users\/|\/home\/)[^\s"'<>]*/g;

function redactSensitiveQueryParams(value: string): string {
  return value
    .replace(BEARER_CREDENTIAL, "[Filtered credential]")
    .replace(SENSITIVE_ASSIGNMENT, "$1$2[Filtered]")
    .replace(QUERY_STRING, "?[Filtered query]")
    .replace(DEEP_LINK, "[Filtered deep link]")
    .replace(PERSONAL_PATH, "[Filtered path]")
    .replace(/\b[A-Z]:\\Users\\[^\s"'<>]*/gi, "[Filtered path]");
}

function devLogsEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem(DEV_LOG_FORCE_KEY) === "true";
  } catch {
    return false;
  }
}

function readLogs(): DevLogEntry[] {
  if (typeof window === "undefined") return [];
  const sanitize = (logs: DevLogEntry[]): boolean => {
    let changed = false;
    logs.forEach((entry, index) => {
      const message = redactSensitiveQueryParams(entry.message);
      const detail = entry.detail
        ? redactSensitiveQueryParams(entry.detail)
        : undefined;
      if (message !== entry.message || detail !== entry.detail) {
        logs[index] = { ...entry, message, detail };
        changed = true;
      }
    });
    return changed;
  };

  if (window.__crateDevLogs) {
    if (sanitize(window.__crateDevLogs)) persistLogs(window.__crateDevLogs);
    return window.__crateDevLogs;
  }
  try {
    const raw = window.localStorage.getItem(DEV_LOG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    window.__crateDevLogs = Array.isArray(parsed) ? parsed : [];
    if (sanitize(window.__crateDevLogs)) persistLogs(window.__crateDevLogs);
    return window.__crateDevLogs;
  } catch {
    window.__crateDevLogs = [];
    return window.__crateDevLogs;
  }
}

function persistLogs(logs: DevLogEntry[]): void {
  try {
    window.localStorage.setItem(DEV_LOG_STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // ignore storage limits in constrained shells
  }
}

function dispatchRecordedLogEvent(entry: DevLogEntry): void {
  const dispatch = () => {
    window.dispatchEvent(
      new CustomEvent<DevLogEntry>(DEV_LOG_EVENT, { detail: entry }),
    );
  };

  if (typeof window.queueMicrotask === "function") {
    window.queueMicrotask(dispatch);
    return;
  }

  window.setTimeout(dispatch, 0);
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (
        key.toLowerCase() === "token" ||
        key.toLowerCase() === "media_ticket"
      ) {
        url.searchParams.set(key, "redacted");
      }
    }
    return redactSensitiveQueryParams(url.toString());
  } catch {
    return redactSensitiveQueryParams(value);
  }
}

export function recordDevLog(
  scope: string,
  message: string,
  detail?: unknown,
  level: DevLogLevel = "info",
): void {
  if (typeof window === "undefined") return;
  if (!devLogsEnabled()) return;
  const logs = readLogs();
  const entry: DevLogEntry = {
    id: Date.now() + Math.random(),
    timestamp: Date.now(),
    level,
    scope,
    message: redactSensitiveQueryParams(message),
    detail:
      redactSensitiveQueryParams(
        typeof detail === "string"
          ? detail
          : detail == null
            ? ""
            : JSON.stringify(detail),
      ) || undefined,
  };
  const next = [...logs, entry].slice(-MAX_LOGS);
  window.__crateDevLogs = next;
  persistLogs(next);
  dispatchRecordedLogEvent(entry);

  const consoleMethod =
    level === "debug"
      ? "debug"
      : level === "warn"
        ? "warn"
        : level === "error"
          ? "error"
          : "info";
  console[consoleMethod](`[${scope}] ${entry.message}`, entry.detail ?? "");
}

export function getDevLogs(): DevLogEntry[] {
  return [...readLogs()];
}

export function getDevLogsSnapshot(): DevLogEntry[] {
  return readLogs();
}

export function clearDevLogs(): void {
  if (typeof window === "undefined") return;
  window.__crateDevLogs = [];
  persistLogs([]);
  window.dispatchEvent(new CustomEvent(DEV_LOG_EVENT));
}

declare global {
  interface Window {
    __crateDevLogs?: DevLogEntry[];
    __crateDevLog?: typeof recordDevLog;
  }
}

if (typeof window !== "undefined") {
  window.__crateDevLog = recordDevLog;
}
