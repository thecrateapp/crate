// Error Inbox admin API (/api/admin/errors). The admin reads PostgreSQL through
// these endpoints; status changes, the connection test, Launch fix and the
// review of fix pull requests (Approve & merge, Discard) enqueue worker tasks.

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
/** Lifecycle of a fix run (`crate.error_inbox.fix_runs`). */
export type FixRunStatus =
  | "requested"
  | "running"
  | "pr_open"
  | "merged"
  | "closed"
  | "failed"
  | "cancelled"
  | "expired";
export type CiState = "pending" | "success" | "failure" | "none";
export type FixExecutor = "github_actions" | "factory";

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
  /** Status of the latest fix run; `pr_open` means its pull request waits. */
  fix_status?: FixRunStatus | null;
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
  /** The model that answered; null once its invocation record is pruned. */
  model: string | null;
  created_at: string;
}

/** Launch fix for one issue; present only when it is configured. */
export interface ErrorIssueFix {
  repository: string;
  workflow: string;
  executor?: FixExecutor;
  /** The workflow's runs on GitHub. */
  actions_url: string;
  /** False when the workflow does not accept this issue's short id. */
  supported: boolean;
  /** Set while the 24-hour window after the last request is open. */
  available_at: string | null;
}

/** What a person with ops.errors.manage can do with a fix run now. */
export interface FixRunReview {
  can_merge: boolean;
  /** Why Approve & merge is unavailable (see `blockerText`). */
  blockers: string[];
  can_discard: boolean;
}

/** One attempt to fix the issue and its pull request, as last seen on GitHub. */
export interface ErrorFixRun {
  id: string;
  executor: FixExecutor;
  status: FixRunStatus;
  repository: string;
  base_ref: string | null;
  external_run_id: string | null;
  external_run_url: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "open" | "closed" | "merged" | null;
  pr_draft: boolean | null;
  pr_mergeable: boolean | null;
  pr_mergeable_state: string | null;
  pr_head_sha: string | null;
  pr_author: string | null;
  pr_labeled: boolean | null;
  ci_state: CiState | null;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: string;
  started_at: string | null;
  pr_opened_at: string | null;
  merge_requested_by_name: string | null;
  merge_requested_at: string | null;
  ready_at: string | null;
  finished_at: string | null;
  checked_at: string | null;
  error_code: string | null;
  summary: string | null;
  cleanup_state: "none" | "pending" | "done" | "failed";
  review: FixRunReview;
}

export interface FixMergeRequest {
  /** The commit the person reviewed; the merge only goes ahead on it. */
  head_sha: string;
}

export interface ErrorIssueDetail extends ErrorIssueSummary {
  provider: "sentry";
  external_id: string;
  digest: Digest | null;
  digest_event_id: string | null;
  digest_hash: string | null;
  fix_requested_by: number | null;
  fix_requested_by_name: string | null;
  closed_at: string | null;
  created_at: string;
  /** Triages and investigations of every digest, newest first. */
  triages: ErrorTriage[];
  /** When automatic triage queued the current digest; null if it never did. */
  auto_triage_queued_at: string | null;
  /** The token's Sentry write scope: false means status actions are unavailable. */
  write_access: boolean | null;
  fix: ErrorIssueFix | null;
  /** The latest fix runs, newest first (at most five). */
  fix_runs: ErrorFixRun[];
}

/** What a sync pass queued for automatic triage. */
export interface SyncTriage {
  status: "off" | "idle" | "queued" | "cap_reached" | "unavailable" | "failed";
  queued: number;
  queued_24h: number | null;
  daily_max: number | null;
  error_code: string | null;
}

export interface SyncState {
  status: "ok" | "partial" | "failed";
  started_at: string | null;
  finished_at: string | null;
  last_success_at: string | null;
  error_code: string | null;
  counts: Record<string, number>;
  truncated: { full: boolean; recent: boolean };
  /** Absent before automatic triage existed or when it never ran. */
  triage?: SyncTriage | null;
}

export interface ErrorSummary {
  configured: boolean;
  open: number;
  critical_open: number;
  new_24h: number;
  regressed_24h: number;
  /** Open issues with an event summary and no triage of it. */
  untriaged: number;
  /** Issues whose fix pull request is open and waits for a person. */
  pending_review?: number;
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

export interface FixConnection {
  repository: string;
  workflow: string;
  ref: string;
  executor?: FixExecutor;
  /** The GitHub token itself is never returned. */
  has_token: boolean;
  actions_url: string;
}

export interface TriageSettings {
  /** Triage new, regressed and escalating issues after each sync. */
  automatic: boolean;
  /** At most this many automatic triages in 24 hours (0–500). */
  daily_max: number;
}

export const MAX_DAILY_TRIAGE = 500;

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
  /** Launch fix settings; null when it is off. */
  fix: FixConnection | null;
  triage: TriageSettings;
}

export interface ErrorIssuePage {
  items: ErrorIssueSummary[];
  next_cursor: string | null;
}

export interface FixSettingsUpdate {
  repository: string;
  workflow: string;
  ref?: string;
  /** Write-only: omitted keeps the stored GitHub token. */
  token?: string;
}

export interface ConnectionUpdate {
  base_url?: string;
  organization: string;
  projects?: string[];
  environments?: string[];
  /** Write-only: omitted keeps the stored token. */
  token?: string;
  /** Omitted keeps the Launch fix settings; null turns Launch fix off. */
  fix?: FixSettingsUpdate | null;
  /** Omitted keeps the triage settings. */
  triage?: TriageSettings;
}

/** The workflow refuses longer notes (`error-autofix.yml`). */
export const MAX_FIX_NOTE_LENGTH = 500;

export interface FixRequest {
  note: string;
}

export interface StatusChange {
  status: IssueStatus;
  in_next_release?: boolean;
  substatus?: string;
}

export interface EnqueuedTask {
  task_id: string;
}

export interface TriageBacklogResult {
  queued: number;
  /** Issues whose triage was already queued or running. */
  deduplicated: number;
  /** One press queues at most this many issues. */
  limit: number;
  task_ids: string[];
}

export const TRIAGE_ACTION = "ops.error.triage";
export const INVESTIGATE_ACTION = "ops.error.investigate";
export const TRIAGE_BACKLOG_URL = `${ERRORS_API}/triage-backlog`;
/** Design §7.1: one Triage backlog press queues at most this many issues. */
export const TRIAGE_BACKLOG_LIMIT = 100;

// -- filters ------------------------------------------------------------------

export type LaneFilter = "all" | "critical" | "review";
export type StatusFilter = IssueStatus | "all";
export type ClassFilter = IssueClassification | "all";

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
    lane: oneOf(params.get("lane"), ["all", "critical", "review"], "all"),
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

export function fixUrl(id: string): string {
  return `${issueUrl(id)}/fix`;
}

export function fixRunUrl(
  issueId: string,
  runId: string,
  action: "merge" | "discard",
): string {
  return `${issueUrl(issueId)}/fix-runs/${encodeURIComponent(runId)}/${action}`;
}

export function investigateUrl(id: string): string {
  return `${issueUrl(id)}/investigate`;
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
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/** "14:05" today, "4 Nov, 14:05" another day, in the browser's time zone. */
export function clockText(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  const clock = clockFormat.format(date);
  return date.toDateString() === now.toDateString()
    ? clock
    : `${dayFormat.format(date)}, ${clock}`;
}

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

/**
 * Why the API refused to queue Launch fix (`ERROR_FIX_*`). GitHub's answers
 * arrive later, as the task's error message, already in plain words.
 */
export function fixProblemText(code: string | null | undefined): string {
  switch (code) {
    case "ERROR_FIX_NOT_CONFIGURED":
      return "Launch fix is not configured. Set it up in the Sentry connection.";
    case "ERROR_FIX_UNSUPPORTED_ISSUE":
      return "The autofix workflow only accepts Crate short ids such as CRATE-API-1F.";
    case "ERROR_FIX_RECENTLY_REQUESTED":
      return "A fix for this issue was launched less than 24 hours ago.";
    case "ERROR_FIX_IN_PROGRESS":
      return "This issue already has a fix in progress. Discard it first.";
    case "ERROR_ISSUE_NOT_FOUND":
      return "This issue is no longer in the inbox.";
    default:
      return "Could not launch the fix. Try again.";
  }
}

// -- fix runs ---------------------------------------------------------------------

const OPEN_FIX_STATUSES: readonly FixRunStatus[] = [
  "requested",
  "running",
  "pr_open",
];

export function isOpenFix(status: FixRunStatus | null | undefined): boolean {
  return OPEN_FIX_STATUSES.includes(status as FixRunStatus);
}

export const FIX_STATUS_LABEL: Record<FixRunStatus, string> = {
  requested: "Requested",
  running: "Running",
  pr_open: "Pending review",
  merged: "Merged",
  closed: "Closed",
  failed: "Failed",
  cancelled: "Discarded",
  expired: "Expired",
};

export function fixStatusTone(status: FixRunStatus): StatusTone {
  switch (status) {
    case "pr_open":
      return "warning";
    case "merged":
      return "success";
    case "requested":
    case "running":
      return "info";
    default:
      return "neutral";
  }
}

export const EXECUTOR_LABEL: Record<FixExecutor, string> = {
  github_actions: "GitHub Actions",
  factory: "Crate Software Factory",
};

export function ciText(state: CiState | null | undefined): string {
  switch (state) {
    case "success":
      return "Passing";
    case "failure":
      return "Failing";
    case "pending":
      return "Running";
    case "none":
      return "No checks";
    default:
      return "Unknown";
  }
}

/** What the run is doing, in a sentence, for the fix panel. */
export function fixRunStateText(run: ErrorFixRun): string {
  switch (run.status) {
    case "requested":
      return "Waiting for the fixer to start.";
    case "running":
      return "The fixer is working on it. Crate checks GitHub every 5 minutes.";
    case "pr_open":
      if (run.merge_requested_at)
        return `Approved by ${run.merge_requested_by_name ?? "someone"}. Crate merges it once the checks of the approved commit pass.`;
      return run.pr_draft
        ? "A draft pull request waits for review."
        : "A pull request waits for review.";
    case "merged":
      return "The pull request was merged.";
    case "closed":
      return "The pull request was closed without merging.";
    case "cancelled":
      return "The fix was discarded.";
    case "expired":
      return "No pull request appeared within 6 hours.";
    case "failed":
      return "The fix did not produce a pull request.";
  }
}

const BLOCKER_TEXT: Record<string, string> = {
  FIX_RUN_NOT_OPEN: "There is no pull request to merge yet.",
  PR_NOT_OPEN: "The pull request is no longer open.",
  PR_NOT_FROM_FIXER:
    "The pull request was not opened by the fixer's GitHub account.",
  PR_NOT_LABELLED: "The pull request does not carry the autofix label.",
  PR_BRANCH_UNEXPECTED: "The pull request is not on a fix branch.",
  PR_CONFLICTS: "The pull request has conflicts.",
  PR_MERGEABILITY_UNKNOWN: "GitHub has not worked out whether it can merge.",
  CHECKS_PENDING: "The checks have not passed yet.",
  CHECKS_FAILED: "A check failed.",
  ALREADY_APPROVED: "It is already approved.",
};

/** Why Approve & merge is unavailable, one sentence per reason. */
export function blockerText(blockers: string[]): string {
  return blockers
    .map((code) => BLOCKER_TEXT[code] ?? `Not available (${code}).`)
    .join(" ");
}

/** Why the API refused Approve & merge or Discard. */
export function fixRunProblemText(
  code: string | null | undefined,
  action: "merge" | "discard",
): string {
  switch (code) {
    case "ERROR_FIX_HEAD_CHANGED":
      return "The pull request changed since this page loaded. Review it again.";
    case "ERROR_FIX_NOT_MERGEABLE":
      return "The pull request cannot be merged from Crate now.";
    case "ERROR_FIX_RUN_CLOSED":
      return "This fix has already ended.";
    case "ERROR_FIX_NOT_CONFIGURED":
      return "Launch fix is not configured. Set it up in the Sentry connection.";
    case "ERROR_FIX_RUN_NOT_FOUND":
    case "ERROR_ISSUE_NOT_FOUND":
      return "This fix is no longer in the inbox.";
    default:
      return action === "merge"
        ? "Could not approve the merge. Try again."
        : "Could not discard the fix. Try again.";
  }
}

/** The latest triage and investigation of the issue's current digest. */
export function currentAssessments(issue: ErrorIssueDetail): {
  triage: ErrorTriage | null;
  investigation: ErrorTriage | null;
} {
  const current = issue.triages.filter(
    (entry) => entry.digest_hash === issue.digest_hash,
  );
  return {
    triage: current.find((entry) => entry.kind === "triage") ?? null,
    investigation:
      current.find((entry) => entry.kind === "investigation") ?? null,
  };
}

/** The newest assessment of an earlier digest, when the current one has none. */
export function previousAssessment(
  issue: ErrorIssueDetail,
): ErrorTriage | null {
  return (
    issue.triages.find((entry) => entry.digest_hash !== issue.digest_hash) ??
    null
  );
}

/**
 * Why the API refused to queue an AI action, or why its task failed. Task
 * failures already arrive in plain words from the worker; these cover the
 * codes the API answers with.
 */
export function aiProblemText(
  code: string | null | undefined,
  action: "triage" | "investigation",
): string {
  const label =
    action === "investigation"
      ? "Investigate error issue"
      : "Triage error issue";
  switch (code) {
    case "ERROR_ISSUE_NOT_FOUND":
      return "This issue is no longer in the inbox.";
    case "ERROR_ISSUE_NO_DIGEST":
      return "This issue has no event summary yet. The next sync downloads it.";
    case "ERROR_ISSUE_ALREADY_INVESTIGATED":
      return "The latest event of this issue has already been investigated.";
    case "AI_CONTEXT_STALE":
      return "The AI configuration is changing. Try again in a moment.";
    case "AI_ACTION_DISABLED":
    case "AI_ACTION_UNKNOWN":
    case "AI_PROFILE_UNKNOWN":
    case "AI_PROFILE_INCOMPATIBLE":
    case "AI_CONNECTION_UNAVAILABLE":
    case "AI_CREDENTIAL_REQUIRED":
    case "AI_CREDENTIAL_UNAVAILABLE":
      return `No usable model is bound to ${label}. Bind one in AI models.`;
    default:
      return action === "investigation"
        ? "Could not start the investigation. Try again."
        : "Could not queue the triage. Try again.";
  }
}

/** The last sync pass's automatic triage, in a sentence; null when off. */
export function triagePassText(
  triage: SyncTriage | null | undefined,
): string | null {
  if (!triage || triage.status === "off") return null;
  const window =
    triage.queued_24h != null && triage.daily_max != null
      ? ` ${formatCount(triage.queued_24h)} of ${formatCount(triage.daily_max)} in the last 24 hours.`
      : "";
  switch (triage.status) {
    case "queued":
      return `The last sync queued ${formatCount(triage.queued)} ${triage.queued === 1 ? "issue" : "issues"} for triage.${window}`;
    case "idle":
      return `The last sync found nothing new to triage.${window}`;
    case "cap_reached":
      return `The daily limit is used up; triage resumes as the 24-hour window moves.${window}`;
    case "unavailable":
      return "The last sync queued nothing: no usable model is bound to Triage error issue. Bind one in AI models.";
    case "failed":
      return "The last sync could not queue triage. It tries again on the next pass.";
    default:
      return null;
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
