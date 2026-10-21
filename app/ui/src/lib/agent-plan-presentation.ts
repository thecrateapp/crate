import { humanizeKey } from "./humanize";
import type { StatusTone } from "@/components/admin/StatusBadge";
import type { AgentPlan } from "./agent-integrations";

const operationLabels: Record<string, string> = {
  repair_photo_flag: "Update artist photo flag",
  shows_import: "Import shows",
  editorial_change: "Change editorial playlist",
  job_retry: "Retry job",
  job_cancel: "Cancel job",
  schedule_run: "Run scheduled task",
  schedule_update: "Change schedule",
  runtime_update: "Change runtime policy",
  health_check: "Run library health check",
  quality_check: "Refresh library quality",
  repairs: "Apply library repairs",
  metadata_update: "Edit metadata",
  enrichment: "Enrich metadata",
  analysis: "Analyze tracks",
  library_sync: "Sync library albums",
  metadata_export: "Export metadata",
  metadata_rehydrate: "Import portable metadata",
};

export function operationLabel(operation: string): string {
  return operationLabels[operation] ?? humanizeKey(operation);
}

export function planTitle(plan: {
  operation: string;
  target_count?: number;
}): string {
  const label = operationLabel(plan.operation);
  if (plan.target_count === undefined) return label;
  const count = plan.target_count;
  return `${label} · ${count} item${count === 1 ? "" : "s"}`;
}

export function planStateView(
  state: string,
  expired: boolean,
): { label: string; tone: StatusTone } {
  if (expired && (state === "awaiting_approval" || state === "ready"))
    return { label: "Expired", tone: "neutral" };
  switch (state) {
    case "awaiting_approval":
      return { label: "Needs approval", tone: "warning" };
    case "ready":
      return { label: "Ready to apply", tone: "info" };
    case "authorized":
      return { label: "Approved", tone: "info" };
    case "queued":
      return { label: "Queued", tone: "info" };
    case "running":
      return { label: "Running", tone: "info" };
    case "applied":
      return { label: "Applied", tone: "success" };
    case "partial":
      return { label: "Partially applied", tone: "warning" };
    case "conflict":
      return { label: "Conflict", tone: "danger" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "rejected":
      return { label: "Rejected", tone: "neutral" };
    default:
      return { label: humanizeKey(state), tone: "neutral" };
  }
}

export function riskView(risk: string | undefined): {
  label: string;
  tone: StatusTone;
} {
  switch (risk) {
    case "safe":
      return { label: "Safe", tone: "success" };
    case "low":
      return { label: "Low risk", tone: "success" };
    case "caution":
      return { label: "Caution", tone: "warning" };
    case "high":
      return { label: "High risk", tone: "danger" };
    case "destructive":
      return { label: "Destructive", tone: "danger" };
    default:
      return { label: "Risk unknown", tone: "neutral" };
  }
}

export function connectionKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "service":
      return "Token";
    case "delegated":
      return "OAuth sign-in";
    case "human":
      return "Admin session";
    default:
      return "Connection";
  }
}

export function reversibilityText(value: string | undefined): string {
  if (value === "new_plan_required")
    return "Can't be undone automatically. Undoing it needs a new plan.";
  if (!value) return "Reversibility not stated.";
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function impactChip(key: string, value: unknown): string | null {
  if (
    (key === "filesystem" || key === "filesystem_writes") &&
    typeof value === "boolean"
  )
    return value ? "Writes files" : "No file changes";
  if (key === "notifications" && typeof value === "boolean")
    return value ? "Sends notifications" : "No notifications";
  if (key === "public" && typeof value === "boolean")
    return value ? "Visible to listeners" : "Not public";
  if (key === "database" && typeof value === "boolean")
    return value ? "Changes the database" : "No database changes";
  if (key === "database_fields" && typeof value === "number")
    return `${value} database field${value === 1 ? "" : "s"}`;
  if (key === "scope" && value === "global") return "Whole library";
  if (key === "scope" && value === "selected") return "Selected items only";
  if (key.endsWith("_count") && typeof value === "number") {
    const noun = key
      .slice(0, -"_count".length)
      .replace(/_/g, " ")
      .toLowerCase();
    return `${value} ${noun}${value === 1 ? "" : "s"}`;
  }
  if (typeof value === "boolean")
    return `${humanizeKey(key)}: ${value ? "Yes" : "No"}`;
  if (typeof value === "number" || typeof value === "string")
    return `${humanizeKey(key)}: ${value}`;
  return null;
}

export function impactChips(impact: Record<string, unknown>): string[] {
  return Object.entries(impact).flatMap(([key, value]) => {
    const chip = impactChip(key, value);
    return chip === null ? [] : [chip];
  });
}

/** Impact entries no chip can express (lists, maps, empty values). */
export function impactDetails(
  impact: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(impact).filter(
      ([key, value]) => impactChip(key, value) === null,
    ),
  );
}

function isRealId(value: unknown): value is number | string {
  return (
    typeof value === "number" || (typeof value === "string" && value !== "")
  );
}

export function requesterText(
  plan: Pick<AgentPlan, "authorization_context" | "requester_name">,
): string | null {
  const context = plan.authorization_context;
  const name = plan.requester_name ?? null;
  if (isRealId(context.human_actor_id))
    return `Prepared in Admin by ${name ?? `user #${context.human_actor_id}`}`;
  if (isRealId(context.actor_user_id))
    return `Delegated by ${name ?? `user #${context.actor_user_id}`}`;
  return null;
}

export type FieldDiffRow = {
  key: string;
  before: unknown;
  after: unknown;
  status: "changed" | "unchanged" | "cleared" | "added";
};

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => deepEqual(value, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

export function fieldDiff(
  before: unknown,
  after: unknown,
): FieldDiffRow[] | null {
  if (!isPlainObject(after)) return null;
  if (before !== null && !isPlainObject(before)) return null;
  const beforeRecord: Record<string, unknown> = isPlainObject(before)
    ? before
    : {};

  const afterKeys = Object.keys(after);
  const beforeOnlyKeys = Object.keys(beforeRecord).filter(
    (key) => !Object.prototype.hasOwnProperty.call(after, key),
  );

  return [...afterKeys, ...beforeOnlyKeys].map((key) => {
    const inAfter = Object.prototype.hasOwnProperty.call(after, key);
    const inBefore = Object.prototype.hasOwnProperty.call(beforeRecord, key);
    const beforeValue = beforeRecord[key];
    const afterValue = inAfter ? after[key] : beforeValue;

    let status: FieldDiffRow["status"];
    if (!inAfter || (inBefore && deepEqual(beforeValue, afterValue))) {
      status = "unchanged";
    } else if (afterValue === null && inBefore && beforeValue !== null) {
      status = "cleared";
    } else if (!inBefore || beforeValue === null) {
      status = "added";
    } else {
      status = "changed";
    }

    return { key, before: beforeValue, after: afterValue, status };
  });
}

export function formatTrackDuration(
  seconds: number | null | undefined,
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/**
 * Readable text for a failed API call. The admin client puts the raw
 * response body in `Error.message`, so a FastAPI `{"detail": "..."}` body is
 * unwrapped and any other JSON falls back instead of reaching the UI.
 */
export function apiErrorText(error: unknown, fallback: string): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!message.trim()) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return message;
  }
  if (isPlainObject(parsed)) {
    const detail = parsed.detail;
    return typeof detail === "string" && detail.trim() ? detail : fallback;
  }
  return Array.isArray(parsed) ? fallback : message;
}
