// Error Inbox admin API (/api/admin/errors). The admin reads PostgreSQL through
// these endpoints; status changes and the connection test enqueue worker tasks.

import type { StatusTone } from "@/components/admin/StatusBadge";

export const ERRORS_API = "/api/admin/errors";
export const ERRORS_VIEW = ["ops.errors.view"] as const;
export const ERRORS_MANAGE = "ops.errors.manage";
export const RUNTIME_MANAGE = "ops.runtime.manage";

export type IssueStatus = "unresolved" | "resolved" | "ignored";
export type IssueLevel = "fatal" | "error" | "warning" | "info" | "debug";
export type IssueClassification =
  | "bug"
  | "infrastructure"
  | "external_dependency"
  | "client_environment"
  | "noise";
export type IssueSeverity = "critical" | "high" | "medium" | "low";

export interface ErrorIssueSummary {
  id: string;
  short_id: string;
  title: string;
  culprit: string | null;
  service: string;
  project_slug: string;
  level: IssueLevel;
  status: IssueStatus;
  substatus: string | null;
  issue_category: string | null;
  sentry_priority: "high" | "medium" | "low" | null;
  events_24h: number;
  users_24h: number;
  events_total: number;
  users_total: number;
  first_seen: string | null;
  last_seen: string | null;
  first_release: string | null;
  last_release: string | null;
  crate_score: number;
  critical: boolean;
  group_key: string | null;
  permalink: string | null;
  fix_requested_at: string | null;
  synced_at: string;
  classification: IssueClassification | null;
  severity: IssueSeverity | null;
}

export interface DigestFrame {
  module: string | null;
  function: string | null;
  filename: string | null;
  lineno: number | null;
  /** [line number, source line] around `lineno`. */
  context: Array<[number, string]>;
}

export interface DigestException {
  type: string | null;
  value: string;
  module: string | null;
  mechanism: string | null;
  handled: boolean | null;
}

export interface Digest {
  v: number;
  event_id: string | null;
  platform: string | null;
  release: string | null;
  message: string | null;
  /** Oldest first: the last one is the exception that was raised. */
  exceptions: DigestException[];
  /** In-app frames, oldest first: the last one is the innermost. */
  frames: DigestFrame[];
  tags: Record<string, string>;
  breadcrumbs: Array<{
    category: string | null;
    level: string | null;
    message: string;
  }>;
  truncated: boolean;
}

export interface ErrorTriage {
  id: string;
  kind: "triage" | "investigation";
  digest_hash: string;
  invocation_id: string | null;
  classification: IssueClassification | null;
  severity: IssueSeverity | null;
  duplicate_of: string | null;
  summary: string;
  hypothesis: string | null;
  suspected_frames: number[];
  next_step: string | null;
  confidence: number;
  created_at: string;
}

export interface ErrorIssueDetail extends ErrorIssueSummary {
  provider: "sentry";
  external_id: string;
  digest: Digest | null;
  digest_event_id: string | null;
  digest_hash: string | null;
  fix_requested_by: number | null;
  closed_at: string | null;
  created_at: string;
  /** Newest first; empty until automatic triage exists. */
  triages: ErrorTriage[];
  /** The token's Sentry write scope: false means status actions are unavailable. */
  write_access: boolean | null;
}

export interface SyncState {
  status: "ok" | "partial" | "failed";
  started_at: string | null;
  finished_at: string | null;
  last_success_at: string | null;
  error_code: string | null;
  counts: Record<string, number>;
  truncated: { full: boolean; recent: boolean };
}

export interface ErrorSummary {
  configured: boolean;
  open: number;
  critical_open: number;
  new_24h: number;
  regressed_24h: number;
  last_synced_at: string | null;
  services: Array<{
    service: string;
    open: number;
    critical: number;
    new_24h: number;
    regressed_24h: number;
  }>;
  top_critical: Array<{
    id: string;
    short_id: string;
    /** Event text: the API omits it for people without ops.errors.view. */
    title?: string;
    service: string;
    crate_score: number;
  }>;
  sync: SyncState | null;
}

export interface ConnectionAccess {
  read: boolean | null;
  write: boolean | null;
  checked_at: string | null;
  source: string | null;
  error_code: string | null;
}

export interface ErrorTrackingConnection {
  configured: boolean;
  provider: "sentry";
  base_url: string;
  organization: string | null;
  projects: string[];
  environments: string[];
  /** The token itself is never returned. */
  has_token: boolean;
  access: ConnectionAccess | null;
  sync: SyncState | null;
}

export interface ErrorIssuePage {
  items: ErrorIssueSummary[];
  next_cursor: string | null;
}

export interface ConnectionUpdate {
  base_url?: string;
  organization: string;
  projects?: string[];
  environments?: string[];
  /** Write-only: omitted keeps the stored token. */
  token?: string;
}

export interface StatusChange {
  status: IssueStatus;
  in_next_release?: boolean;
  substatus?: string;
}

export interface EnqueuedTask {
  task_id: string;
}

// -- filters ------------------------------------------------------------------

export type LaneFilter = "all" | "critical";
export type StatusFilter = IssueStatus | "all";

export interface IssueFilters {
  lane: LaneFilter;
  status: StatusFilter;
  service: string;
  classification: string;
  release: string;
}

export const DEFAULT_FILTERS: IssueFilters = {
  lane: "all",
  status: "unresolved",
  service: "",
  classification: "",
  release: "",
};

export const PAGE_SIZE = 50;

function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Filters from the page URL; unknown values fall back to the defaults. */
export function filtersFromParams(params: URLSearchParams): IssueFilters {
  return {
    lane: oneOf(params.get("lane"), ["all", "critical"], "all"),
    status: oneOf(
      params.get("status"),
      ["unresolved", "resolved", "ignored", "all"],
      "unresolved",
    ),
    service: params.get("service") ?? "",
    classification: params.get("classification") ?? "",
    release: params.get("release") ?? "",
  };
}

/** URL parameters for the filters, omitting defaults so links stay short. */
export function filtersToParams(filters: IssueFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_FILTERS) as (keyof IssueFilters)[]) {
    if (filters[key] && filters[key] !== DEFAULT_FILTERS[key])
      params.set(key, filters[key]);
  }
  return params;
}

export function hasActiveFilters(filters: IssueFilters): boolean {
  return filtersToParams(filters).toString() !== "";
}

/** The list endpoint for the filters; the cursor is appended by the pager. */
export function issuesUrl(filters: IssueFilters): string {
  const params = new URLSearchParams({
    status: filters.status,
    lane: filters.lane,
    limit: String(PAGE_SIZE),
  });
  if (filters.service) params.set("service", filters.service);
  if (filters.classification)
    params.set("classification", filters.classification);
  if (filters.release) params.set("release", filters.release);
  return `${ERRORS_API}?${params.toString()}`;
}

export function issueUrl(id: string): string {
  return `${ERRORS_API}/${encodeURIComponent(id)}`;
}

export function issuePath(id: string): string {
  return `/errors/${encodeURIComponent(id)}`;
}

// -- ordering and grouping ------------------------------------------------------

export interface IssueGroup {
  /** The group key, or the issue id for an issue without duplicates. */
  key: string;
  /** Highest-priority member: its title and status represent the group. */
  lead: ErrorIssueSummary;
  /** Every member in priority order, lead first. */
  members: ErrorIssueSummary[];
  critical: boolean;
  events_24h: number;
  users_24h: number;
  last_seen: string | null;
  crate_score: number;
}

export interface IssueLane {
  id: "critical" | "other";
  groups: IssueGroup[];
  issueCount: number;
}

function newer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function byPriority(a: ErrorIssueSummary, b: ErrorIssueSummary): number {
  if (a.critical !== b.critical) return a.critical ? -1 : 1;
  return b.crate_score - a.crate_score;
}

/**
 * Critical lane first, then the rest, each in Crate priority order. Issues that
 * share a `group_key` are duplicate candidates and collapse into one group,
 * placed where its highest-priority member would be; a group is critical when
 * any member is. Array.prototype.sort is stable, so ties keep the API order.
 */
export function laneGroups(issues: ErrorIssueSummary[]): IssueLane[] {
  const ordered = [...issues].sort(byPriority);
  const groups = new Map<string, IssueGroup>();
  for (const issue of ordered) {
    const key = issue.group_key ? `group:${issue.group_key}` : issue.id;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        key,
        lead: issue,
        members: [issue],
        critical: issue.critical,
        events_24h: issue.events_24h,
        users_24h: issue.users_24h,
        last_seen: issue.last_seen,
        crate_score: issue.crate_score,
      });
      continue;
    }
    group.members.push(issue);
    group.critical ||= issue.critical;
    group.events_24h += issue.events_24h;
    group.users_24h += issue.users_24h;
    group.last_seen = newer(group.last_seen, issue.last_seen);
    group.crate_score = Math.max(group.crate_score, issue.crate_score);
  }
  const all = [...groups.values()];
  const critical = all.filter((group) => group.critical);
  const other = all.filter((group) => !group.critical);
  const count = (list: IssueGroup[]) =>
    list.reduce((total, group) => total + group.members.length, 0);
  return [
    { id: "critical" as const, groups: critical, issueCount: count(critical) },
    { id: "other" as const, groups: other, issueCount: count(other) },
  ].filter((lane) => lane.groups.length > 0);
}

/** Releases seen in the loaded issues, newest-looking first, for the filter. */
export function knownReleases(issues: ErrorIssueSummary[]): string[] {
  const releases = new Set<string>();
  for (const issue of issues) {
    if (issue.last_release) releases.add(issue.last_release);
    if (issue.first_release) releases.add(issue.first_release);
  }
  return [...releases].sort((a, b) => b.localeCompare(a));
}

// -- presentation ----------------------------------------------------------------

export const CLASSIFICATION_LABEL: Record<IssueClassification, string> = {
  bug: "Bug",
  infrastructure: "Infrastructure",
  external_dependency: "External dependency",
  client_environment: "Client environment",
  noise: "Noise",
};

export const STATUS_LABEL: Record<IssueStatus, string> = {
  unresolved: "Unresolved",
  resolved: "Resolved",
  ignored: "Ignored",
};

const SUBSTATUS_LABEL: Record<string, string> = {
  new: "New",
  regressed: "Regressed",
  escalating: "Escalating",
  ongoing: "Ongoing",
};

export function substatusLabel(substatus: string | null): string | null {
  if (!substatus) return null;
  if (SUBSTATUS_LABEL[substatus]) return SUBSTATUS_LABEL[substatus];
  if (substatus.startsWith("archived_")) return "Archived";
  return null;
}

/** Substatuses that deserve attention get the warning tone. */
export function substatusTone(substatus: string | null): StatusTone {
  return substatus === "regressed" || substatus === "escalating"
    ? "warning"
    : "neutral";
}

const syncFormat = new Intl.NumberFormat("en");

export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : syncFormat.format(value);
}

/**
 * A plain account of why the last sync or connection check failed. The codes
 * come from the worker (`SENTRY_*`) or the configuration (`ERROR_TRACKING_*`).
 */
export function problemText(code: string | null | undefined): string {
  switch (code) {
    case null:
    case undefined:
    case "":
      return "The last sync failed for an unknown reason.";
    case "SENTRY_AUTH":
      return "Sentry rejected the token. It may have been revoked or mistyped; store a new one.";
    case "SENTRY_FORBIDDEN":
      return "The token is missing a permission Crate needs: org:read, project:read and event:read.";
    case "SENTRY_NOT_FOUND":
      return "Sentry could not find the organization or one of the projects. Check their names.";
    case "SENTRY_UNAVAILABLE":
    case "SENTRY_TIMEOUT":
    case "SENTRY_SERVER":
      return "Crate could not reach Sentry. It will try again on the next sync.";
    case "SENTRY_RATE_LIMITED":
      return "Sentry is limiting requests from Crate. It will try again on the next sync.";
    case "SENTRY_HOST_DISALLOWED":
      return "The Sentry address points to a network Crate refuses to call. Check the base URL.";
    case "SENTRY_WRITE_SCOPE_MISSING":
    case "ERROR_TRACKING_WRITE_SCOPE_MISSING":
      return "The token cannot change issues in Sentry: it lacks event:write.";
    case "ERROR_TRACKING_NOT_CONFIGURED":
      return "Error tracking is not configured.";
    case "ERROR_TRACKING_INVALID":
      return "The stored connection settings are invalid. Save them again.";
    case "ERROR_TRACKING_TOKEN_MISSING":
      return "No Sentry token is stored. Add one to start syncing.";
    case "ERROR_TRACKING_TOKEN_UNAVAILABLE":
      return "Crate cannot read the stored token. Store it again.";
    default:
      return `Sentry answered in a way Crate did not expect (${code}).`;
  }
}

/** True when the problem needs someone to fix the connection, not just wait. */
export function needsConnectionFix(code: string | null | undefined): boolean {
  return [
    "SENTRY_AUTH",
    "SENTRY_FORBIDDEN",
    "SENTRY_NOT_FOUND",
    "SENTRY_HOST_DISALLOWED",
    "ERROR_TRACKING_INVALID",
    "ERROR_TRACKING_TOKEN_MISSING",
    "ERROR_TRACKING_TOKEN_UNAVAILABLE",
  ].includes(code ?? "");
}

/** Short heading for a failed sync, used by the list's connection state. */
export function problemTitle(code: string | null | undefined): string {
  if (code === "SENTRY_AUTH") return "Sentry rejected the token";
  if (code === "SENTRY_FORBIDDEN") return "The token lacks a permission";
  if (code === "SENTRY_NOT_FOUND") return "Organization or project not found";
  if (needsConnectionFix(code)) return "The connection needs attention";
  return "Sentry is unreachable";
}

export function accessText(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

/** `X-Crate-Error` header first, then a JSON body carrying `code`. */
export function apiErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code) return code;
  const message = error instanceof Error ? error.message : "";
  try {
    const body = JSON.parse(message) as {
      code?: unknown;
      detail?: { code?: unknown };
    };
    const nested =
      typeof body.code === "string"
        ? body.code
        : typeof body.detail?.code === "string"
          ? body.detail.code
          : null;
    return nested || null;
  } catch {
    return null;
  }
}

/** Comma- or newline-separated names, trimmed, empty entries dropped. */
export function parseNameList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
