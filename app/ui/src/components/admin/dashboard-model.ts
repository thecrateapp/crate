import type { OpsSnapshotData } from "@/contexts/OpsSnapshotContext";

const queueNames = [
  "fast",
  "default",
  "heavy",
  "maintenance",
  "playback",
] as const;
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
function date(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function queueTotal(queue: unknown): number | null {
  if (!queue || typeof queue !== "object") return null;
  const values = queueNames.map((name) =>
    count((queue as Record<string, unknown>)[name]),
  );
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + value!, 0);
  return Number.isSafeInteger(total) ? total : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function taskName(value: unknown) {
  const name = text(value);
  const names: Record<string, string> = {
    sync_library: "Library sync",
    enrich_artists: "Artist enrichment",
    enrich_albums: "Album enrichment",
    analyze_track: "Audio analysis",
    compute_bliss: "Bliss analysis",
    analyze_all: "Audio analysis",
  };
  return name ? (names[name] ?? name.replace(/_/g, " ")) : "Unknown task";
}
function progress(value: unknown) {
  const empty = {
    percent: null as number | null,
    quantity: null as string | null,
    detail: "Progress unavailable",
  };
  const raw = text(value);
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.startsWith("{") || raw.startsWith("[")
      ? empty
      : { ...empty, detail: raw };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return empty;
  const data = parsed as Record<string, unknown>;
  const done = count(data.done),
    total = count(data.total);
  const fraction =
    done !== null && total !== null && total > 0 && done <= total;
  const percent = fraction
    ? Math.round((done / total) * 1000) / 10
    : typeof data.percent === "number" &&
        Number.isFinite(data.percent) &&
        data.percent >= 0 &&
        data.percent <= 100
      ? data.percent
      : null;
  const detail = [text(data.phase), text(data.item) ?? text(data.artist)]
    .filter(Boolean)
    .join(" · ");
  return {
    percent,
    quantity: fraction ? `${done} / ${total}` : null,
    detail: detail || empty.detail,
  };
}

export function getDashboardModel(
  data: OpsSnapshotData,
  error: string | null,
  now: number,
) {
  const built = date(data.snapshot?.built_at),
    deadline = date(data.snapshot?.stale_after);
  const expired =
    data.snapshot?.stale === true || (deadline !== null && deadline <= now);
  const freshness =
    error || expired
      ? "stale"
      : built === null || deadline === null || built > now || deadline <= built
        ? "unknown"
        : "current";
  const signals = [
    {
      id: "postgres",
      label: "PostgreSQL",
      value: data.live?.systems?.postgres,
      detail: "Database-dependent work may be affected.",
    },
    {
      id: "watcher",
      label: "Library watcher",
      value: data.live?.systems?.watcher,
      detail: "New filesystem changes may not be detected.",
    },
    {
      id: "redis",
      label: "Event Redis",
      value: data.eventing?.domain_events?.redis_connected,
      detail: "Domain event delivery may be interrupted.",
    },
  ].map(({ value, ...signal }) => ({
    ...signal,
    state:
      value === true
        ? ("online" as const)
        : value === false
          ? ("offline" as const)
          : ("unknown" as const),
  }));
  const attention =
    freshness === "current"
      ? signals.filter((signal) => signal.state === "offline")
      : [];
  const headline = error
    ? "Could not update the report"
    : freshness === "stale"
      ? "Report out of date"
      : freshness === "unknown"
        ? "Report freshness unknown"
        : attention.length
          ? "Service interruption reported"
          : signals.some((signal) => signal.state === "unknown")
            ? "Some service signals unavailable"
            : "Reported services responding";
  const work = (
    Array.isArray(data.live?.running_tasks) ? data.live.running_tasks : []
  ).map((task) => ({
    id: task.id,
    label: taskName(task.type),
    status: text(task.status) ?? "Status unavailable",
    updatedAt: date(task.updated_at) !== null ? task.updated_at! : null,
    ...progress(task.progress),
  }));
  // SSE retains these producer markers; REST may omit them. Outer freshness cannot replace them.
  const analysis = data.analysis as
    | (OpsSnapshotData["analysis"] & { stale?: unknown; unavailable?: unknown })
    | undefined;
  const analysisFreshness =
    analysis?.unavailable === true
      ? "unavailable"
      : analysis?.stale === true || freshness === "stale"
        ? "stale"
        : analysis?.stale === false && freshness === "current"
          ? "current"
          : "unknown";
  const analysisActive =
      analysisFreshness === "unavailable"
        ? null
        : count(analysis?.analysis_active),
    blissActive =
      analysisFreshness === "unavailable"
        ? null
        : count(analysis?.bliss_active);
  const daemons = [
    { label: "Audio analysis", active: analysisActive },
    { label: "Bliss analysis", active: blissActive },
  ].filter(
    (item): item is { label: string; active: number } =>
      item.active !== null && item.active > 0,
  );
  const recent = (
    Array.isArray(data.live?.recent_tasks) ? data.live.recent_tasks : []
  )
    .filter((task) => {
      const timestamp = date(task.updated_at);
      return timestamp !== null && timestamp <= now;
    })
    .sort((a, b) => date(b.updated_at)! - date(a.updated_at)!);
  function last(status: string) {
    const task = recent.find((task) => task.status === status);
    return task
      ? { id: task.id, label: taskName(task.type), updatedAt: task.updated_at }
      : null;
  }
  return {
    freshness,
    headline,
    builtAt: built === null ? null : data.snapshot.built_at!,
    deadline,
    signals,
    attention,
    running: queueTotal(data.live?.queue_breakdown?.running),
    waiting: queueTotal(data.live?.queue_breakdown?.pending),
    work,
    daemons,
    analysisFreshness,
    analysisReported: analysisActive !== null && blissActive !== null,
    lastCompleted: last("completed"),
    lastFailed: last("failed"),
  };
}
