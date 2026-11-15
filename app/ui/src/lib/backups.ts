/**
 * Admin backups (BK5): API shapes, URLs and presentation helpers for the
 * Backups page. The API lives under /api/admin/backups (BK4) and needs
 * `system.backups.manage`. Secrets are write-only: responses only name the
 * secrets that are set (`secrets_set`).
 */

export const BACKUPS_API = "/api/admin/backups";
export const BACKUPS_CAPABILITY = "system.backups.manage";
export const BACKUPS_MANAGE = [BACKUPS_CAPABILITY] as const;
/** Dispatched after a change that can move the sidebar's failing counter. */
export const BACKUPS_CHANGED_EVENT = "crate:backups-changed";
export const KIT_PASSPHRASE_MIN = 12;
/** Connection tests can take minutes on a slow provider. */
export const TEST_TIMEOUT_MS = 15 * 60 * 1000;

export function notifyBackupsChanged(): void {
  window.dispatchEvent(new Event(BACKUPS_CHANGED_EVENT));
}

export type BackupKind = "local" | "s3" | "b2" | "sftp" | "gdrive" | "dropbox";
export type BackupHealth =
  "healthy" | "late" | "failing" | "untested" | "disabled";
export type BackupTier = "daily" | "weekly" | "monthly";
export const TIERS: readonly BackupTier[] = ["daily", "weekly", "monthly"];

export interface BackupDestination {
  id: string;
  kind: BackupKind;
  provider: string;
  name: string;
  config: Record<string, unknown>;
  location: string;
  secrets_set: string[];
  missing_secrets: string[];
  oauth: boolean;
  enabled: boolean;
  status: string;
  last_checked_at?: string | null;
  last_error?: string | null;
  repository_initialized_at?: string | null;
  snapshot_count?: number | null;
  repository_bytes?: number | null;
  recovery_kit_downloaded_at?: string | null;
  recovery_kit_confirmed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BackupRunRow {
  id?: string;
  kind?: string;
  status?: string;
  started_at?: string | null;
  finished_at?: string | null;
  bytes?: number | null;
  checksum?: string | null;
  error?: string | null;
  snapshot_id?: string | null;
  details?: Record<string, unknown>;
}

export interface BackupDestinationHealth extends BackupDestination {
  health: BackupHealth;
  last_copy_at?: string | null;
  last_copy_snapshot?: string | null;
  late_after_hours?: number | null;
  tiers: BackupTier[];
  policy_ids: string[];
  last_verify?: BackupRunRow | null;
  last_drill?: BackupRunRow | null;
  kit_covered: boolean;
}

export interface BackupAlert {
  level: "danger" | "warning";
  kind: string;
  destination_id?: string | null;
  title: string;
  text: string;
  at?: string | null;
  action?: string | null;
}

export interface BackupLatestCheck {
  at?: string | null;
  destination_id?: string;
  destination?: string;
  status?: string | null;
  details?: Record<string, unknown>;
}

export interface BackupOverviewStats {
  last_copy_at?: string | null;
  last_copy_destination?: string | null;
  stored_bytes?: number;
  repositories?: number;
  snapshots?: number;
  latest_dump?: BackupRunRow | null;
  last_verify?: BackupLatestCheck | null;
  last_drill?: BackupLatestCheck | null;
}

export interface BackupPolicySummary {
  id: string;
  name: string;
  enabled: boolean;
  schedule_kind: string;
  next_run?: string | null;
  destination_count: number;
}

export interface BackupLocalRetention {
  keep_daily: number;
  keep_weekly: number;
  keep_monthly: number;
}

export interface BackupOverview {
  generated_at: string;
  destinations: BackupDestinationHealth[];
  failing_count: number;
  late_count: number;
  kit: {
    saved: boolean;
    uncovered: number;
    total: number;
    downloaded_at?: string | null;
  };
  stats: BackupOverviewStats;
  alerts: BackupAlert[];
  size_series: {
    destination_id: string;
    name: string;
    points: { day: string; bytes: number }[];
  }[];
  policies: BackupPolicySummary[];
  local_retention: BackupLocalRetention;
  local_backups_enabled: boolean;
}

export interface BackupProviderField {
  name: string;
  label: string;
  required: boolean;
  secret?: boolean;
  system: boolean;
  default?: unknown;
}

export interface BackupProvider {
  kind: BackupKind;
  label: string;
  oauth: boolean;
  config_fields: BackupProviderField[];
  secret_fields: BackupProviderField[];
}

export type ScheduleKind = "daily" | "hours" | "manual";
export type Compression = "auto" | "max" | "off";

export interface BackupPolicy {
  id: string;
  name: string;
  enabled: boolean;
  schedule_kind: ScheduleKind;
  daily_at?: string | null;
  interval_hours?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  keep_daily: number;
  keep_weekly: number;
  keep_monthly: number;
  compression: Compression;
  verify_every_days: number;
  verify_read_percent: number;
  drill_every_days: number;
  drill_destination_id?: string | null;
  run_before_upgrade: boolean;
  last_scheduled_at?: string | null;
  next_run?: string | null;
  destinations: Record<string, BackupTier[]>;
  created_at?: string | null;
  updated_at?: string | null;
}

export type BackupRunKind =
  "dump" | "local_retention" | "offsite" | "verify" | "restore_drill";
export type BackupRunStatus = "running" | "succeeded" | "failed";

export interface BackupRun {
  id: string;
  kind: string;
  status: BackupRunStatus;
  task_id?: string | null;
  policy_id?: string | null;
  policy_name?: string | null;
  destination_id?: string | null;
  destination_name?: string | null;
  started_at: string;
  finished_at?: string | null;
  duration_seconds?: number | null;
  path?: string | null;
  bytes?: number | null;
  checksum?: string | null;
  snapshot_id?: string | null;
  error?: string | null;
  details?: Record<string, unknown>;
}

export interface BackupRunList {
  items: BackupRun[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface BackupSnapshot {
  id: string;
  time?: string | null;
  host?: string | null;
  tags: string[];
  paths: string[];
}

export interface BackupSnapshotList {
  destination_id: string;
  listed_at?: string | null;
  snapshot_count?: number | null;
  snapshots: BackupSnapshot[];
}

export interface TaskEnqueue {
  task_id: string;
  deduplicated?: boolean;
}

/** `result.connection` of a connection test task. */
export interface ConnectionResult {
  status: "ok" | "failing" | "unavailable";
  error?: string | null;
  repository?: string | null;
  snapshot_count?: number | null;
  repository_bytes?: number | null;
  learned?: string[];
}

export function connectionFromTask(
  result?: Record<string, unknown>,
): ConnectionResult | null {
  const raw = result?.connection;
  if (!raw || typeof raw !== "object") return null;
  const connection = raw as Record<string, unknown>;
  const status = connection.status;
  if (status !== "ok" && status !== "failing" && status !== "unavailable")
    return null;
  return connection as unknown as ConnectionResult;
}

// ── labels ──────────────────────────────────────────────────────────

export const KIND_LABEL: Record<BackupKind, string> = {
  local: "Backup volume",
  s3: "S3-compatible",
  b2: "Backblaze B2",
  sftp: "SFTP",
  gdrive: "Google Drive",
  dropbox: "Dropbox",
};

export const HEALTH_LABEL: Record<BackupHealth, string> = {
  healthy: "Healthy",
  late: "Late",
  failing: "Failing",
  untested: "Untested",
  disabled: "Disabled",
};

export const RUN_KIND_LABEL: Record<string, string> = {
  dump: "Dump",
  local_retention: "Local retention",
  offsite: "Off-site",
  verify: "Verify",
  restore_drill: "Restore drill",
};

export const RUN_STATUS_LABEL: Record<BackupRunStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

export interface S3Preset {
  id: string;
  label: string;
  endpoint: string;
  endpointHint: string;
  region: string;
  regionHint?: string;
  bucketLookup: "auto" | "dns" | "path";
  host?: RegExp;
}

/** Presets only fill the form: the API stores endpoint, region and lookup. */
export const S3_PRESETS: readonly S3Preset[] = [
  {
    id: "r2",
    label: "Cloudflare R2",
    endpoint: "https://<account id>.r2.cloudflarestorage.com",
    endpointHint: "https://<account id>.r2.cloudflarestorage.com",
    region: "auto",
    regionHint: "R2 uses auto.",
    bucketLookup: "auto",
    host: /\.r2\.cloudflarestorage\.com$/,
  },
  {
    id: "wasabi",
    label: "Wasabi",
    endpoint: "https://s3.eu-central-1.wasabisys.com",
    endpointHint: "https://s3.<region>.wasabisys.com",
    region: "eu-central-1",
    bucketLookup: "auto",
    host: /wasabisys\.com$/,
  },
  {
    id: "minio",
    label: "MinIO",
    endpoint: "https://minio.example.com:9000",
    endpointHint: "Your MinIO server, with its port.",
    region: "",
    bucketLookup: "path",
    host: /minio/i,
  },
  {
    id: "hetzner",
    label: "Hetzner Object Storage",
    endpoint: "https://fsn1.your-objectstorage.com",
    endpointHint: "https://<location>.your-objectstorage.com",
    region: "fsn1",
    bucketLookup: "auto",
    host: /your-objectstorage\.com$/,
  },
  {
    id: "aws",
    label: "AWS S3",
    endpoint: "https://s3.eu-central-1.amazonaws.com",
    endpointHint: "https://s3.<region>.amazonaws.com",
    region: "eu-central-1",
    bucketLookup: "auto",
    host: /amazonaws\.com$/,
  },
  {
    id: "other",
    label: "Other",
    endpoint: "",
    endpointHint: "The provider's S3 endpoint URL.",
    region: "",
    bucketLookup: "auto",
  },
];

function endpointHost(endpoint: unknown): string {
  if (typeof endpoint !== "string" || !endpoint) return "";
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "";
  }
}

export function s3PresetFor(endpoint: unknown): S3Preset {
  const host = endpointHost(endpoint);
  return (
    S3_PRESETS.find(
      (preset) => preset.host && host && preset.host.test(host),
    ) ?? S3_PRESETS[S3_PRESETS.length - 1]!
  );
}

/** "S3 · Cloudflare R2", "Local", "SFTP": the short kind badge. */
export function kindBadge(destination: {
  kind: BackupKind;
  config: Record<string, unknown>;
}): string {
  if (destination.kind === "local") return "Local";
  if (destination.kind === "s3") {
    const preset = s3PresetFor(destination.config.endpoint);
    return preset.id === "other" ? "S3" : `S3 · ${preset.label}`;
  }
  return KIND_LABEL[destination.kind];
}

// ── formatting ──────────────────────────────────────────────────────

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function toDate(value: string | number | Date | null | undefined) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "10 Nov 03:37" in the browser's time zone. */
export function formatStamp(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A coming run: "Today 18:00", "Tonight 03:30", "Tomorrow 09:00", "Sun 15 Nov 03:30". */
export function formatNext(
  value: string | null | undefined,
  now: number = Date.now(),
): string {
  const date = toDate(value);
  if (!date) return "—";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = new Date(now);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (date.getTime() - now < 86_400_000 && date.getTime() >= now) {
    if (sameDay(date, today)) return `Today ${time}`;
    if (date.getHours() < 6) return `Tonight ${time}`;
    return `Tomorrow ${time}`;
  }
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

/** "12 Aug" in the browser's time zone. */
export function formatDay(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "16 min ago", "13 h ago", "1 d 13 h ago", "34 d ago". */
export function formatAgo(
  value: string | null | undefined,
  now: number = Date.now(),
): string {
  const date = toDate(value);
  if (!date) return "Never";
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (days < 2 && rest) return `${days} d ${rest} h ago`;
  return `${days} d ago`;
}

/** "17.6 GB", "1.38 GB", "820 MB". */
export function formatBackupBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit < 3 ? 0 : value < 10 ? 2 : 1;
  return `${Number(value.toFixed(digits))} ${units[unit]}`;
}

/** "38 s", "3 min 41 s", "1 h 05 min". */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min ${pad(total % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
}

export function formatHours(hours: number): string {
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} days`;
  if (hours >= 48) return `${(hours / 24).toFixed(1)} days`;
  return `${Math.round(hours)} h`;
}

/** The schedule a destination gets from its tiers, for its card. */
export function tiersSchedule(
  destination: Pick<BackupDestinationHealth, "tiers" | "policy_ids">,
  policies: readonly Pick<
    BackupPolicy,
    "id" | "schedule_kind" | "daily_at" | "interval_hours"
  >[],
): string {
  if (!destination.tiers.length) return "No tiers yet";
  const policy = policies.find((p) => destination.policy_ids.includes(p.id));
  const tiers = destination.tiers;
  if (tiers.includes("daily") && policy) {
    if (policy.schedule_kind === "daily" && policy.daily_at)
      return `Daily at ${policy.daily_at}`;
    if (policy.schedule_kind === "hours" && policy.interval_hours)
      return `Every ${policy.interval_hours} h`;
  }
  if (tiers.includes("daily")) return "Daily";
  if (tiers.includes("weekly"))
    return policy?.daily_at ? `Sundays ${policy.daily_at}` : "Weekly";
  return "Monthly";
}

/** One line for a policy in the list: "Daily 03:30 · 4 destinations". */
export function policyLine(
  policy: Pick<
    BackupPolicy,
    "schedule_kind" | "daily_at" | "interval_hours" | "destinations"
  >,
): string {
  const count = Object.keys(policy.destinations).length;
  const where = `${count} destination${count === 1 ? "" : "s"}`;
  if (policy.schedule_kind === "daily")
    return `Daily ${policy.daily_at ?? ""} · ${where}`.replace("  ", " ");
  if (policy.schedule_kind === "hours")
    return `Every ${policy.interval_hours ?? "?"} h · ${where}`;
  return `Manual only · ${where}`;
}

// ── retention estimate ──────────────────────────────────────────────

/** How far back the oldest kept copy reaches, as words. */
export function reachText(
  counts: Pick<
    BackupLocalRetention,
    "keep_daily" | "keep_weekly" | "keep_monthly"
  >,
): string {
  const days = Math.max(
    counts.keep_daily,
    counts.keep_weekly * 7,
    counts.keep_monthly * 30,
  );
  if (days >= 60) return `about ${Math.round(days / 30)} months`;
  if (days >= 14) return `about ${Math.round(days / 7)} weeks`;
  return `about ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Which of the last `days` days still have a copy: daily for the last N days,
 * weekly on the last N Sundays, monthly on the last N month ends. Mirrors the
 * restic --keep-* buckets well enough for a picture.
 */
export function keptDays(
  counts: Pick<
    BackupLocalRetention,
    "keep_daily" | "keep_weekly" | "keep_monthly"
  >,
  today: Date,
  days = 120,
): Map<number, BackupTier> {
  const kept = new Map<number, BackupTier>();
  for (let d = 0; d < Math.min(counts.keep_daily, days); d++)
    kept.set(d, "daily");
  let weeks = 0;
  let months = 0;
  for (let d = 0; d < days; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    if (weeks < counts.keep_weekly && day.getDay() === 0) {
      weeks += 1;
      if (!kept.has(d)) kept.set(d, "weekly");
    }
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    if (months < counts.keep_monthly && next.getDate() === 1 && d > 0) {
      months += 1;
      if (!kept.has(d)) kept.set(d, "monthly");
    }
  }
  return kept;
}

/**
 * Distinct copies a destination keeps with these tiers: a copy that is both
 * the day's and the week's counts once, as restic's --keep-* buckets do.
 */
export function keptCopies(
  counts: Pick<
    BackupLocalRetention,
    "keep_daily" | "keep_weekly" | "keep_monthly"
  >,
  tiers: readonly BackupTier[],
  today: Date,
): number {
  return keptDays(
    {
      keep_daily: tiers.includes("daily") ? counts.keep_daily : 0,
      keep_weekly: tiers.includes("weekly") ? counts.keep_weekly : 0,
      keep_monthly: tiers.includes("monthly") ? counts.keep_monthly : 0,
    },
    today,
    Math.max(
      counts.keep_daily,
      counts.keep_weekly * 7,
      counts.keep_monthly * 31,
    ) + 31,
  ).size;
}

// ── recovery kit ────────────────────────────────────────────────────

export class KitDownloadError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function kitFilename(header: string | null): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  if (match?.[1]) return match[1];
  const now = new Date();
  return `crate-recovery-kit-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}.md.age`;
}

/**
 * The kit is a binary body, so it bypasses the JSON api client. A 403 is a
 * wrong password, not an expired session: it must not redirect to login.
 */
export async function downloadRecoveryKit(
  password: string,
  passphrase: string,
): Promise<string> {
  const response = await fetch(`${BACKUPS_API}/recovery-kit`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Crate-Client": "admin-web",
    },
    body: JSON.stringify({ password, passphrase }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      detail = "";
    }
    throw new KitDownloadError(
      response.status,
      detail || "The recovery kit could not be downloaded",
    );
  }
  const blob = await response.blob();
  const filename = kitFilename(response.headers.get("Content-Disposition"));
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return filename;
}

// ── rclone authorize ────────────────────────────────────────────────

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * `rclone authorize drive "<blob>"` with the install's own client and the
 * drive.file scope (BG1-10). The two-argument form asks for the full drive
 * scope and must not be used. rclone 1.76 reads the blob unpadded.
 */
export function rcloneDriveAuthorizeCommand(
  clientId: string,
  clientSecret: string,
): string {
  const blob = base64Url(
    JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "drive.file",
    }),
  );
  return `rclone authorize drive "${blob}"`;
}

export function rcloneDropboxAuthorizeCommand(
  appKey: string,
  appSecret: string,
): string {
  const blob = base64Url(
    JSON.stringify({ client_id: appKey, client_secret: appSecret }),
  );
  return `rclone authorize dropbox "${blob}"`;
}
