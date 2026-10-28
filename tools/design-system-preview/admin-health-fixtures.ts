import { useSyncExternalStore } from "react";
import fixture from "../../tests/admin-e2e/fixtures/health-1ad.json";
export type HealthSample =
  | "ready"
  | "loading"
  | "empty"
  | "partial"
  | "offline"
  | "unknown"
  | "stale"
  | "limited"
  | "mixed"
  | "refresh-error";
const listeners = new Set<() => void>();
let health = {
  ...structuredClone(fixture.health),
  counts: { ...fixture.health.counts } as Record<string, number>,
  runs: { ...fixture.health.runs } as Record<
    string,
    (typeof fixture.health.runs)["unindexed_files"]
  >,
};
type SampleTask = Omit<(typeof fixture.tasks.history)[number], "result"> & {
  result: Record<string, unknown>;
};
let tasks: { history: SampleTask[] } = structuredClone(fixture.tasks);
let pending: { id: string; check: string | null; type: string } | null = null,
  counter = 0;
let refreshFailuresRemaining = 0;
let state: {
  sample: HealthSample;
  generation: number;
  outcome: string;
  doneFor: string | null;
  done: { status: string; result?: Record<string, unknown> } | null;
} = {
  sample: "ready",
  generation: 0,
  outcome: "Sin acciones de muestra.",
  doneFor: null,
  done: null,
};
function emit() {
  listeners.forEach((l) => l());
}
export function subscribeHealthSample(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function healthSampleState() {
  return state;
}
export function setHealthSample(sample: HealthSample) {
  health = {
    ...structuredClone(fixture.health),
    counts: { ...fixture.health.counts },
  };
  tasks = structuredClone(fixture.tasks);
  pending = null;
  refreshFailuresRemaining = sample === "refresh-error" ? 1 : 0;
  if (sample === "empty" || sample === "unknown") {
    health.issues = [];
    health.counts = {};
    health.total = 0;
    tasks.history = [];
  }
  if (sample === "unknown") health.runs = {};
  if (sample === "stale") health.snapshot.stale = true;
  if (sample === "limited") health.counts.unindexed_files = 600;
  if (sample === "mixed") {
    health.issues.push({
      ...structuredClone(fixture.health.issues[0]!),
      id: 105,
      severity: "critical",
      description: "Sample critical unindexed file",
      details_json: {
        artist: "Costa Norte",
        path: "/music/Costa Norte/Muestra/105.flac",
      },
    });
    health.counts.unindexed_files = 2;
    health.total = 5;
    health.runs.unindexed_files!.issue_count = 2;
    tasks.history[0]!.result = {
      issue_count: 5,
      revalidation: { issue_count: 5 },
    };
  }
  state = {
    sample,
    generation: state.generation + 1,
    outcome: "Sin acciones de muestra.",
    doneFor: null,
    done: null,
  };
  emit();
}
function reset() {
  if (state.done) {
    state = { ...state, done: null, doneFor: null };
    emit();
  }
}
export function useTaskEvents(taskId: string | null) {
  const s = useSyncExternalStore(subscribeHealthSample, healthSampleState);
  return {
    events: [],
    connected: false,
    done: taskId === s.doneFor ? s.done : null,
    reset,
  };
}
function removeIssues(
  predicate: (issue: (typeof health.issues)[number]) => boolean,
) {
  const removed = health.issues.filter(predicate);
  health.issues = health.issues.filter((i) => !predicate(i));
  for (const issue of removed) {
    const count = Math.max(0, (health.counts[issue.check_type] ?? 0) - 1);
    if (count) health.counts[issue.check_type] = count;
    else delete health.counts[issue.check_type];
  }
  health.total = health.issues.length;
}
export function completeHealthTask() {
  if (!pending) return;
  const before = health.issues.length;
  if (pending.check)
    removeIssues((i) => i.check_type === pending!.check && i.auto_fixable);
  const remaining = Object.values(health.counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const result = {
    ...(pending.type === "health_check"
      ? { issue_count: remaining }
      : { summary: { applied: before - health.issues.length } }),
    revalidation: { issue_count: remaining },
  };
  tasks.history = [
    {
      id: pending.id,
      type: pending.type,
      status: "completed",
      error: null,
      result,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  state = {
    ...state,
    doneFor: pending.id,
    done: { status: "completed", result },
    outcome: "Tarea ficticia completada; revalidación local.",
  };
  pending = null;
  emit();
}
// Page-specific adapter. All paths are local fixtures; no request or real operation occurs.
export async function api<T>(
  path: string,
  method = "GET",
  _body?: unknown,
  options?: { signal?: AbortSignal },
): Promise<T> {
  if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = new URL(path, "http://sample.test");
  if (method === "GET") {
    if (url.pathname === "/api/manage/repair-catalog") {
      if (state.sample === "partial")
        throw new Error("Sample catalog unavailable");
      return structuredClone(fixture.catalog) as T;
    }
    if (url.pathname === "/api/admin/tasks-snapshot")
      return structuredClone(tasks) as T;
    if (url.pathname === "/api/admin/health-snapshot") {
      if (state.sample === "loading") return new Promise<T>(() => {});
      if (state.sample === "offline")
        throw new Error("Sample health unavailable");
      if (
        state.sample === "refresh-error" &&
        url.searchParams.get("fresh") === "1" &&
        refreshFailuresRemaining > 0
      ) {
        refreshFailuresRemaining -= 1;
        throw new Error("Sample refresh unavailable");
      }
      const check = url.searchParams.get("check_type");
      return {
        ...structuredClone(health),
        issues: health.issues.filter((i) => !check || i.check_type === check),
      } as T;
    }
  }
  if (method === "POST") {
    const issue = url.pathname.match(
      /^\/api\/manage\/health-issues\/(\d+)\/(resolve|dismiss)$/,
    );
    const dismiss = url.pathname.match(
      /^\/api\/manage\/health-issues\/dismiss-type\/([a-z_]+)$/,
    );
    const fix = url.pathname.match(
      /^\/api\/manage\/health-issues\/fix-type\/([a-z_]+)$/,
    );
    if (issue) removeIssues((i) => i.id === Number(issue[1]));
    else if (dismiss) {
      removeIssues((i) => i.check_type === dismiss[1]);
      delete health.counts[dismiss[1]!];
    } else if (
      fix ||
      url.pathname === "/api/manage/health-check" ||
      url.pathname === "/api/manage/repair-duplicate-tracks"
    ) {
      const check =
        fix?.[1] ??
        (url.pathname.endsWith("repair-duplicate-tracks")
          ? "duplicate_tracks"
          : null);
      pending = {
        id: `sample-health-${state.generation}-${++counter}`,
        check,
        type: check ? "repair" : "health_check",
      };
    } else throw new Error("Unexpected sample action");
    state = { ...state, outcome: `POST ${url.pathname} · muestra local` };
    emit();
    return {
      task_id: pending?.id ?? null,
      task_ids: pending ? [pending.id] : [],
      fixable: 1,
      allowed: true,
    } as T;
  }
  throw new Error("Unexpected Health sample path");
}
// Only the isolated document installs this inert stream boundary.
export class HealthSampleEventSource {
  readonly readyState = 1;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {
    if (
      !url.startsWith("/api/admin/health-stream") &&
      !url.startsWith("/api/admin/tasks-stream")
    )
      throw new Error("Unexpected sample stream");
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }
  close() {}
}
