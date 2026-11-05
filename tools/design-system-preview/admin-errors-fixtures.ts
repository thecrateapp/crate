// Local Error Inbox preview: the real Errors pages served by fake endpoints.
// Synthetic data only (app/ui/src/test/error-inbox-fixtures.ts); no backend,
// no Sentry. Status changes and connection tests resolve after a short delay,
// as the worker task would.
import { useCallback, useEffect, useRef, useState } from "react";
import { createUseApi } from "../../app/shared/web/use-api";
import type {
  ConnectionUpdate,
  Digest,
  ErrorIssueDetail,
  ErrorIssueSummary,
  ErrorSummary,
  ErrorTrackingConnection,
  StatusChange,
} from "../../app/ui/src/lib/error-inbox";
import {
  NOT_CONFIGURED_CONNECTION,
  NOT_CONFIGURED_SUMMARY,
  minutesAgo,
  sampleConnection,
  sampleDetail,
  sampleIssues,
  sampleSummary,
  sampleSync,
} from "../../app/ui/src/test/error-inbox-fixtures";

export type ErrorsScenario =
  "ready" | "not-configured" | "token-rejected" | "unreachable" | "read-only";

export const SCENARIOS: { value: ErrorsScenario; label: string }[] = [
  { value: "ready", label: "Ready" },
  { value: "not-configured", label: "Not configured" },
  { value: "token-rejected", label: "Token rejected" },
  { value: "unreachable", label: "Sentry unreachable" },
  { value: "read-only", label: "Read-only token" },
];

interface PreviewState {
  scenario: ErrorsScenario;
  issues: ErrorIssueSummary[];
  connection: ErrorTrackingConnection;
  version: number;
}

const listeners = new Set<() => void>();
const pendingTasks = new Map<string, () => Record<string, unknown> | Error>();
let taskCounter = 0;
let state = build("ready");

function build(scenario: ErrorsScenario): PreviewState {
  const issues = sampleIssues();
  if (scenario === "not-configured")
    return {
      scenario,
      issues: [],
      connection: NOT_CONFIGURED_CONNECTION,
      version: 0,
    };
  if (scenario === "token-rejected")
    return {
      scenario,
      issues: [],
      connection: sampleConnection({
        access: {
          read: false,
          write: false,
          checked_at: minutesAgo(2),
          source: "sync",
          error_code: "SENTRY_AUTH",
        },
        sync: sampleSync({
          status: "failed",
          error_code: "SENTRY_AUTH",
          last_success_at: null,
          counts: {},
        }),
      }),
      version: 0,
    };
  if (scenario === "unreachable")
    return {
      scenario,
      issues,
      connection: sampleConnection({
        access: {
          read: null,
          write: null,
          checked_at: minutesAgo(1),
          source: "sync",
          error_code: "SENTRY_UNAVAILABLE",
        },
        sync: sampleSync({
          status: "failed",
          error_code: "SENTRY_UNAVAILABLE",
          finished_at: minutesAgo(1),
          last_success_at: minutesAgo(46),
        }),
      }),
      version: 0,
    };
  if (scenario === "read-only")
    return {
      scenario,
      issues,
      connection: sampleConnection({
        access: {
          read: true,
          write: false,
          checked_at: minutesAgo(3),
          source: "connection_test",
          error_code: null,
        },
      }),
      version: 0,
    };
  return { scenario, issues, connection: sampleConnection(), version: 0 };
}

function publish(next: Partial<PreviewState>) {
  state = { ...state, ...next, version: state.version + 1 };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot() {
  return state;
}

export function setScenario(scenario: ErrorsScenario) {
  pendingTasks.clear();
  state = { ...build(scenario), version: state.version + 1 };
  listeners.forEach((listener) => listener());
}

function summary(): ErrorSummary {
  if (!state.connection.configured) return NOT_CONFIGURED_SUMMARY;
  const base = sampleSummary({}, state.issues);
  return {
    ...base,
    last_synced_at:
      state.connection.sync?.last_success_at ?? base.last_synced_at,
    sync: state.connection.sync,
  };
}

function digestFor(issue: ErrorIssueSummary): Digest {
  const [type, ...rest] = issue.title.split(": ");
  const value = rest.join(": ") || issue.title;
  const fn = issue.culprit?.split(/[ .(]/).filter(Boolean).at(-1) ?? "handler";
  return {
    v: 1,
    event_id: `${issue.id.replace(/-/g, "").slice(0, 24)}feedbeef`,
    platform: issue.service === "readplane" ? "go" : "javascript",
    release: issue.last_release,
    message: null,
    exceptions: [
      {
        type: type ?? null,
        value,
        module: null,
        mechanism: null,
        handled: false,
      },
    ],
    frames: [
      {
        module: issue.project_slug,
        function: fn,
        filename:
          issue.service === "readplane"
            ? "internal/proxy/fallback.go"
            : "src/lib/api.ts",
        lineno: 88,
        context: [
          [86, "  const response = await upstream(request);"],
          [87, "  if (!response.ok) recordFailure(response.status);"],
          [88, "  throw new UpstreamError(response.status);"],
          [89, "}"],
        ],
      },
    ],
    tags: {
      service: issue.service,
      environment: "production",
      release: issue.last_release ?? "unknown",
    },
    breadcrumbs: [
      { category: "http", level: "info", message: "GET /api/<path> 200" },
      { category: "http", level: "error", message: "GET /api/<path> 502" },
    ],
    truncated: false,
  };
}

function detail(id: string): ErrorIssueDetail | null {
  const issue = state.issues.find((item) => item.id === id);
  if (!issue) return null;
  const rich = sampleDetail();
  const base =
    rich.id === id
      ? { ...rich, ...issue }
      : {
          ...rich,
          ...issue,
          external_id: issue.short_id.split("-").at(-1) ?? "1",
          digest: digestFor(issue),
        };
  return {
    ...base,
    write_access: state.connection.access?.write ?? null,
  };
}

function list(query: URLSearchParams) {
  const status = query.get("status") ?? "unresolved";
  const lane = query.get("lane") ?? "all";
  const service = query.get("service");
  const classification = query.get("classification");
  const release = query.get("release");
  const limit = Number(query.get("limit") ?? 50);
  const offset = Number(query.get("cursor") ?? 0);
  const matching = state.issues.filter(
    (issue) =>
      (status === "all" || issue.status === status) &&
      (lane === "all" || issue.critical) &&
      (!service || issue.service === service) &&
      (!classification || issue.classification === classification) &&
      (!release ||
        issue.first_release === release ||
        issue.last_release === release),
  );
  const items = matching.slice(offset, offset + limit);
  return {
    items,
    next_cursor:
      offset + limit < matching.length ? String(offset + limit) : null,
  };
}

function fail(status: number, code: string, detail: string): never {
  throw Object.assign(new Error(JSON.stringify({ detail })), { status, code });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  await wait(120);
  const [pathname = "", search = ""] = path.split("?");
  const root = "/api/admin/errors";
  if (method === "GET" && pathname === root)
    return list(new URLSearchParams(search)) as T;
  if (method === "GET" && pathname === `${root}/summary`) return summary() as T;
  if (pathname === `${root}/connection`) {
    if (method === "GET") return state.connection as T;
    const update = body as ConnectionUpdate;
    const hasToken = state.connection.has_token || Boolean(update.token);
    publish({
      connection: {
        ...state.connection,
        base_url: update.base_url || "https://sentry.io",
        organization: update.organization,
        projects: update.projects ?? [],
        environments: update.environments ?? [],
        has_token: hasToken,
        configured: Boolean(update.organization) && hasToken,
      },
    });
    return state.connection as T;
  }
  if (method === "POST" && pathname === `${root}/connection/test`) {
    if (!state.connection.configured)
      fail(409, "ERROR_TRACKING_NOT_CONFIGURED", "Not configured");
    const taskId = `preview-test-${++taskCounter}`;
    pendingTasks.set(taskId, () => {
      const rejected = state.scenario === "token-rejected";
      const access = rejected
        ? { read: false, write: false }
        : {
            read: true,
            write: state.scenario === "read-only" ? false : true,
          };
      publish({
        connection: {
          ...state.connection,
          access: {
            ...access,
            checked_at: new Date().toISOString(),
            source: "connection_test",
            error_code: rejected ? "SENTRY_AUTH" : null,
          },
        },
      });
      return rejected
        ? new Error("Sentry rejected the token")
        : { status: "succeeded", access };
    });
    return { task_id: taskId } as T;
  }
  const statusMatch = pathname.match(/^\/api\/admin\/errors\/([^/]+)\/status$/);
  if (method === "POST" && statusMatch) {
    const id = decodeURIComponent(statusMatch[1]!);
    if (state.connection.access?.write === false)
      fail(409, "ERROR_TRACKING_WRITE_SCOPE_MISSING", "Write scope missing");
    const change = body as StatusChange;
    const taskId = `preview-status-${++taskCounter}`;
    pendingTasks.set(taskId, () => {
      publish({
        issues: state.issues.map((issue) =>
          issue.id === id
            ? {
                ...issue,
                status: change.status,
                substatus:
                  change.substatus ??
                  (change.status === "unresolved" ? "ongoing" : null),
              }
            : issue,
        ),
      });
      return { status: "succeeded", issue_status: change.status };
    });
    return { task_id: taskId } as T;
  }
  const detailMatch = pathname.match(/^\/api\/admin\/errors\/([^/]+)$/);
  if (method === "GET" && detailMatch) {
    const found = detail(decodeURIComponent(detailMatch[1]!));
    if (!found) fail(404, "ERROR_ISSUE_NOT_FOUND", "Error issue not found");
    return found as T;
  }
  fail(404, "PREVIEW_UNKNOWN", `No preview fixture for ${method} ${path}`);
}

export const useApi = createUseApi(
  { useState, useEffect, useCallback, useRef },
  api as Parameters<typeof createUseApi>[1],
);

/** Same contract as the admin hook: the fake task finishes after a moment. */
export function useTaskPoll() {
  const pollTask = useCallback(
    (
      taskId: string,
      onComplete: (result?: Record<string, unknown>) => void,
      onFailed?: (error?: string) => void,
    ) => {
      window.setTimeout(() => {
        const run = pendingTasks.get(taskId);
        pendingTasks.delete(taskId);
        const outcome = run?.() ?? { status: "succeeded" };
        if (outcome instanceof Error) onFailed?.(outcome.message);
        else onComplete(outcome);
      }, 1200);
    },
    [],
  );
  return { pollTask, stopPolling: () => undefined };
}
