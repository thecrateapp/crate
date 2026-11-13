// Response-shaped Backups fixtures (BK4 API), from the approved BG1 mockup
// data: an install seen on Tuesday 10 Nov 2026 at 16:50 UTC.
import type {
  BackupDestinationHealth,
  BackupOverview,
  BackupPolicy,
  BackupProvider,
  BackupRun,
  BackupRunList,
  BackupSnapshotList,
} from "@/lib/backups";

export const BACKUPS_NOW = Date.parse("2026-11-10T16:50:00Z");
const GB = 1024 ** 3;
const gb = (value: number) => Math.round(value * GB);

export const POLICY_NIGHTLY = "11111111-1111-4111-8111-111111111111";
export const POLICY_UPGRADES = "22222222-2222-4222-8222-222222222222";

function destination(
  values: Partial<BackupDestinationHealth> &
    Pick<
      BackupDestinationHealth,
      "id" | "kind" | "name" | "location" | "health"
    >,
): BackupDestinationHealth {
  return {
    provider: values.kind,
    config: {},
    secrets_set: [],
    missing_secrets: [],
    oauth: values.kind === "gdrive" || values.kind === "dropbox",
    enabled: true,
    status: "ok",
    last_checked_at: "2026-11-10T03:37:00Z",
    last_error: null,
    repository_initialized_at: "2026-08-12T03:30:00Z",
    snapshot_count: null,
    repository_bytes: null,
    recovery_kit_downloaded_at: null,
    recovery_kit_confirmed_at: null,
    created_at: "2026-08-12T03:00:00Z",
    updated_at: "2026-11-10T03:37:00Z",
    last_copy_at: null,
    last_copy_snapshot: null,
    late_after_hours: 36,
    tiers: ["daily", "weekly", "monthly"],
    policy_ids: [POLICY_NIGHTLY],
    last_verify: null,
    last_drill: null,
    kit_covered: false,
    ...values,
  };
}

export const DESTINATIONS: BackupDestinationHealth[] = [
  destination({
    id: "dest-local",
    kind: "local",
    name: "Backup volume",
    provider: "Backup volume",
    location: "/backups/restic",
    config: { path: "restic" },
    health: "healthy",
    last_copy_at: "2026-11-10T03:32:00Z",
    tiers: ["daily", "weekly"],
    last_checked_at: "2026-11-10T03:32:00Z",
    last_verify: {
      status: "succeeded",
      started_at: "2026-11-07T04:00:00Z",
      finished_at: "2026-11-07T04:02:00Z",
    },
    last_drill: {
      status: "succeeded",
      started_at: "2026-10-29T04:05:00Z",
      finished_at: "2026-10-29T04:14:00Z",
    },
    snapshot_count: 13,
    repository_bytes: gb(17.6),
    recovery_kit_confirmed_at: "2026-08-12T04:00:00Z",
    kit_covered: true,
  }),
  destination({
    id: "dest-r2",
    kind: "s3",
    name: "Cloudflare R2",
    provider: "S3-compatible (Cloudflare R2, Wasabi, MinIO, Hetzner, AWS)",
    location:
      "5f0c2a9e1b7d4c3a8e6f2b1d9c4a7e30.r2.cloudflarestorage.com/crate-backups/db",
    config: {
      endpoint:
        "https://5f0c2a9e1b7d4c3a8e6f2b1d9c4a7e30.r2.cloudflarestorage.com",
      bucket: "crate-backups",
      prefix: "db",
      region: "auto",
      bucket_lookup: "auto",
    },
    secrets_set: ["access_key_id", "secret_access_key"],
    health: "healthy",
    last_copy_at: "2026-11-10T03:37:00Z",
    last_verify: { status: "running", started_at: "2026-11-10T16:42:00Z" },
    last_drill: {
      status: "succeeded",
      started_at: "2026-10-29T04:05:00Z",
      finished_at: "2026-10-29T04:14:00Z",
    },
    snapshot_count: 13,
    repository_bytes: gb(17.9),
  }),
  destination({
    id: "dest-gdrive",
    kind: "gdrive",
    name: "Google Drive",
    provider: "Google Drive",
    location: "Google Drive: crate-backups/db",
    config: {
      path: "crate-backups/db",
      root_folder_id: "",
      client_id:
        "418530221944-q2n8s1m0v7c4k9e3h6t5b0a2d1f8g7j.apps.googleusercontent.com",
    },
    secrets_set: ["client_secret", "token"],
    health: "late",
    last_copy_at: "2026-11-09T03:41:00Z",
    last_checked_at: "2026-11-09T03:41:00Z",
    last_verify: {
      status: "succeeded",
      started_at: "2026-11-08T05:12:00Z",
      finished_at: "2026-11-08T05:23:00Z",
    },
    last_drill: {
      status: "succeeded",
      started_at: "2026-10-01T04:00:00Z",
      finished_at: "2026-10-01T04:09:00Z",
    },
    snapshot_count: 12,
    repository_bytes: gb(16.4),
  }),
  destination({
    id: "dest-hetzner",
    kind: "sftp",
    name: "Hetzner Storage Box",
    provider: "SFTP (Hetzner Storage Box, rsync.net, a home server)",
    location: "u412345@u412345.your-storagebox.de:23/crate/restic",
    config: {
      host: "u412345.your-storagebox.de",
      port: 23,
      user: "u412345",
      path: "crate/restic",
      known_hosts:
        "[u412345.your-storagebox.de]:23 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIICf9svRenC/PLKIL9nk6K/pxQgoiFC41wTNvoIncOxs",
      public_key:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK7v3cQ9yLw2mXn0aR8tP4sJ1fH6dB5eZqU0oN2kV9gT crate-backups@Hetzner Storage Box",
    },
    secrets_set: ["private_key"],
    health: "failing",
    status: "failing",
    last_error: "Permission denied (publickey) since 9 Nov 03:40.",
    last_copy_at: "2026-11-02T03:44:00Z",
    last_checked_at: "2026-11-10T16:34:00Z",
    late_after_hours: 252,
    tiers: ["weekly", "monthly"],
    last_verify: {
      status: "succeeded",
      started_at: "2026-10-26T04:00:00Z",
      finished_at: "2026-10-26T04:05:00Z",
    },
    snapshot_count: 6,
    repository_bytes: gb(8.1),
  }),
  destination({
    id: "dest-dropbox",
    kind: "dropbox",
    name: "Dropbox",
    provider: "Dropbox",
    location: "Dropbox: crate-backups",
    config: { path: "crate-backups", client_id: "k3x9w2pq7m4t1zr" },
    secrets_set: ["client_secret"],
    missing_secrets: ["token"],
    health: "disabled",
    enabled: false,
    status: "untested",
    last_checked_at: null,
    repository_initialized_at: null,
    tiers: [],
    policy_ids: [],
  }),
  destination({
    id: "dest-minio",
    kind: "s3",
    name: "MinIO at home",
    provider: "S3-compatible (Cloudflare R2, Wasabi, MinIO, Hetzner, AWS)",
    location: "minio.home.arpa:9000/crate",
    config: {
      endpoint: "https://minio.home.arpa:9000",
      bucket: "crate",
      prefix: "",
      region: "",
      bucket_lookup: "path",
    },
    secrets_set: ["access_key_id", "secret_access_key"],
    health: "disabled",
    enabled: false,
    last_copy_at: "2026-10-07T03:36:00Z",
    last_checked_at: "2026-10-07T03:36:00Z",
    tiers: [],
    policy_ids: [],
    last_verify: {
      status: "succeeded",
      started_at: "2026-10-06T04:00:00Z",
      finished_at: "2026-10-06T04:03:00Z",
    },
    snapshot_count: 9,
    repository_bytes: gb(11.2),
    recovery_kit_confirmed_at: "2026-08-12T04:00:00Z",
    kit_covered: true,
  }),
];

function series(
  start: number,
  plateau: number,
  offsetDays: number,
  stopAt?: number,
) {
  const out: { day: string; bytes: number }[] = [];
  let last = 0;
  for (let d = -90; d <= 0; d += 3) {
    if (d < offsetDays) continue;
    let value: number;
    if (stopAt !== undefined && d > stopAt) value = last;
    else {
      const age = d - offsetDays;
      value =
        start +
        (plateau - start) * (1 - Math.exp(-age / 22)) +
        Math.sin(d / 5) * 0.35;
    }
    last = value;
    const day = new Date(BACKUPS_NOW + d * 86_400_000)
      .toISOString()
      .slice(0, 10);
    out.push({ day, bytes: gb(Math.round(value * 10) / 10) });
  }
  return out;
}

export const OVERVIEW: BackupOverview = {
  generated_at: "2026-11-10T16:50:00Z",
  destinations: DESTINATIONS,
  failing_count: 1,
  late_count: 1,
  kit: {
    saved: false,
    uncovered: 4,
    total: 6,
    downloaded_at: null,
  },
  stats: {
    last_copy_at: "2026-11-10T03:37:00Z",
    last_copy_destination: "Cloudflare R2",
    stored_bytes: gb(60),
    repositories: 4,
    snapshots: 44,
    latest_dump: {
      status: "succeeded",
      started_at: "2026-11-10T03:30:00Z",
      finished_at: "2026-11-10T03:31:52Z",
      bytes: gb(1.38),
      checksum: "sha256:2f1c…",
    },
    last_verify: {
      at: "2026-11-08T05:23:00Z",
      destination_id: "dest-gdrive",
      destination: "Google Drive",
      status: "succeeded",
      details: { read_percent: 5, snapshot_count: 12 },
    },
    last_drill: {
      at: "2026-10-29T04:14:00Z",
      destination_id: "dest-r2",
      destination: "Cloudflare R2",
      status: "succeeded",
      details: {},
    },
  },
  alerts: [
    {
      level: "danger",
      kind: "destination_failing",
      destination_id: "dest-hetzner",
      title: "Hetzner Storage Box is failing",
      text: "The server refuses Crate's SSH key since 9 Nov 03:40. Its last good copy is 8 days old.",
      at: "2026-11-09T03:44:00Z",
      action: "test",
    },
    {
      level: "warning",
      kind: "copy_late",
      destination_id: "dest-gdrive",
      title: "No recent copy on Google Drive",
      text: "No good copy within 36 hours, 1.5 times its schedule.",
      at: "2026-11-09T03:41:00Z",
      action: "run",
    },
  ],
  size_series: [
    {
      destination_id: "dest-r2",
      name: "Cloudflare R2",
      points: series(1.3, 18.1, -90),
    },
    {
      destination_id: "dest-gdrive",
      name: "Google Drive",
      points: series(1.3, 16.8, -84),
    },
    {
      destination_id: "dest-local",
      name: "Backup volume",
      points: series(1.3, 17.7, -90),
    },
    {
      destination_id: "dest-hetzner",
      name: "Hetzner Storage Box",
      points: series(1.3, 9.6, -66, -9),
    },
  ],
  policies: [
    {
      id: POLICY_NIGHTLY,
      name: "Nightly",
      enabled: true,
      schedule_kind: "daily",
      next_run: "2026-11-11T03:30:00Z",
      destination_count: 4,
    },
    {
      id: POLICY_UPGRADES,
      name: "Before upgrades",
      enabled: true,
      schedule_kind: "manual",
      next_run: null,
      destination_count: 2,
    },
  ],
  local_retention: { keep_daily: 3, keep_weekly: 4, keep_monthly: 3 },
  local_backups_enabled: true,
};

export const POLICIES: BackupPolicy[] = [
  {
    id: POLICY_NIGHTLY,
    name: "Nightly",
    enabled: true,
    schedule_kind: "daily",
    daily_at: "03:30",
    interval_hours: null,
    window_start: "02:00",
    window_end: "06:00",
    keep_daily: 7,
    keep_weekly: 4,
    keep_monthly: 3,
    compression: "auto",
    verify_every_days: 7,
    verify_read_percent: 5,
    drill_every_days: 30,
    drill_destination_id: null,
    run_before_upgrade: false,
    next_run: "2026-11-11T03:30:00Z",
    destinations: {
      "dest-local": ["daily", "weekly"],
      "dest-r2": ["daily", "weekly", "monthly"],
      "dest-gdrive": ["daily", "weekly", "monthly"],
      "dest-hetzner": ["weekly", "monthly"],
    },
  },
  {
    id: POLICY_UPGRADES,
    name: "Before upgrades",
    enabled: true,
    schedule_kind: "manual",
    daily_at: null,
    interval_hours: null,
    window_start: null,
    window_end: null,
    keep_daily: 0,
    keep_weekly: 0,
    keep_monthly: 3,
    compression: "auto",
    verify_every_days: 0,
    verify_read_percent: 5,
    drill_every_days: 0,
    drill_destination_id: null,
    run_before_upgrade: true,
    next_run: null,
    destinations: {
      "dest-local": ["monthly"],
      "dest-r2": ["monthly"],
    },
  },
];

const field = (
  name: string,
  label: string,
  extra: Partial<BackupProvider["config_fields"][number]> = {},
) => ({ name, label, required: false, system: false, ...extra });

export const PROVIDERS: BackupProvider[] = [
  {
    kind: "local",
    label: "Backup volume",
    oauth: false,
    config_fields: [
      field("path", "Folder in the backup directory", { required: true }),
    ],
    secret_fields: [],
  },
  {
    kind: "s3",
    label: "S3-compatible (Cloudflare R2, Wasabi, MinIO, Hetzner, AWS)",
    oauth: false,
    config_fields: [
      field("endpoint", "Endpoint URL", { required: true }),
      field("bucket", "Bucket", { required: true }),
      field("prefix", "Folder in the bucket", { default: "" }),
      field("region", "Region", { default: "" }),
      field("bucket_lookup", "Bucket lookup", { default: "auto" }),
    ],
    secret_fields: [
      field("access_key_id", "Access key ID", { required: true, secret: true }),
      field("secret_access_key", "Secret access key", {
        required: true,
        secret: true,
      }),
    ],
  },
  {
    kind: "b2",
    label: "Backblaze B2",
    oauth: false,
    config_fields: [
      field("bucket", "Bucket", { required: true }),
      field("prefix", "Folder in the bucket", { default: "" }),
    ],
    secret_fields: [
      field("key_id", "Application key ID", { required: true, secret: true }),
      field("application_key", "Application key", {
        required: true,
        secret: true,
      }),
    ],
  },
  {
    kind: "sftp",
    label: "SFTP (Hetzner Storage Box, rsync.net, a home server)",
    oauth: false,
    config_fields: [
      field("host", "Host", { required: true }),
      field("port", "Port", { default: 22 }),
      field("user", "User", { required: true }),
      field("path", "Folder on the server", { required: true }),
      field("known_hosts", "Pinned host key", { default: "" }),
      field("public_key", "Public key", { system: true }),
    ],
    secret_fields: [
      field("private_key", "Private key", { secret: true, system: true }),
    ],
  },
  {
    kind: "gdrive",
    label: "Google Drive",
    oauth: true,
    config_fields: [
      field("path", "Folder", { default: "crate-backups" }),
      field("root_folder_id", "Root folder ID", { default: "" }),
      field("client_id", "OAuth client ID", { default: "" }),
    ],
    secret_fields: [
      field("client_secret", "OAuth client secret", { secret: true }),
      field("token", "OAuth token", { secret: true }),
    ],
  },
  {
    kind: "dropbox",
    label: "Dropbox",
    oauth: true,
    config_fields: [
      field("path", "Folder", { default: "crate-backups" }),
      field("client_id", "App key", { default: "" }),
    ],
    secret_fields: [
      field("client_secret", "App secret", { secret: true }),
      field("token", "OAuth token", { secret: true }),
    ],
  },
];

export const HETZNER_ERROR = `subprocess ssh: u412345@u412345.your-storagebox.de: Permission denied (publickey).
Fatal: unable to open repository at sftp:u412345@u412345.your-storagebox.de:23/crate/restic: unable to start the sftp session, error: EOF`;

function run(
  values: Partial<BackupRun> &
    Pick<BackupRun, "id" | "kind" | "status" | "started_at">,
): BackupRun {
  return {
    task_id: `task-${values.id}`,
    policy_id: POLICY_NIGHTLY,
    policy_name: "Nightly",
    destination_id: null,
    destination_name: null,
    finished_at: null,
    duration_seconds: null,
    bytes: null,
    snapshot_id: null,
    error: null,
    details: {},
    ...values,
  };
}

export const RUNS: BackupRun[] = [
  run({
    id: "r1",
    kind: "verify",
    status: "running",
    started_at: "2026-11-10T16:42:00Z",
    destination_id: "dest-r2",
    destination_name: "Cloudflare R2",
    policy_id: null,
    policy_name: null,
  }),
  run({
    id: "r2",
    kind: "offsite",
    status: "succeeded",
    started_at: "2026-11-10T03:37:00Z",
    destination_id: "dest-r2",
    destination_name: "Cloudflare R2",
    duration_seconds: 221,
    bytes: gb(1.31),
    snapshot_id: "a91f03c2d4e5f6a7",
  }),
  run({
    id: "r3",
    kind: "offsite",
    status: "succeeded",
    started_at: "2026-11-10T03:32:00Z",
    destination_id: "dest-local",
    destination_name: "Backup volume",
    duration_seconds: 38,
    bytes: gb(1.31),
    snapshot_id: "7c2e91fa00112233",
  }),
  run({
    id: "r4",
    kind: "local_retention",
    status: "succeeded",
    started_at: "2026-11-10T03:32:00Z",
    duration_seconds: 2,
    details: { deleted: ["crate-20261103-0330.dump"] },
  }),
  run({
    id: "r5",
    kind: "dump",
    status: "succeeded",
    started_at: "2026-11-10T03:30:00Z",
    duration_seconds: 112,
    bytes: gb(1.38),
    path: "/backups/dumps/crate-20261110-0330.dump",
  }),
  run({
    id: "6f1c0b9e-0000-4000-8000-000000000006",
    kind: "offsite",
    status: "failed",
    started_at: "2026-11-09T03:44:00Z",
    destination_id: "dest-hetzner",
    destination_name: "Hetzner Storage Box",
    duration_seconds: 4,
    error: HETZNER_ERROR,
    task_id: "7d2e5b1c9a41c",
    details: { tags: ["weekly"] },
  }),
  run({
    id: "r7",
    kind: "offsite",
    status: "succeeded",
    started_at: "2026-11-09T03:41:00Z",
    destination_id: "dest-gdrive",
    destination_name: "Google Drive",
    duration_seconds: 363,
    bytes: gb(1.3),
    snapshot_id: "e04d6b1700000000",
  }),
  run({
    id: "r8",
    kind: "offsite",
    status: "succeeded",
    started_at: "2026-11-09T03:36:00Z",
    destination_id: "dest-r2",
    destination_name: "Cloudflare R2",
    duration_seconds: 218,
    bytes: gb(1.3),
    snapshot_id: "3b8c55e000000000",
  }),
  run({
    id: "r9",
    kind: "offsite",
    status: "succeeded",
    started_at: "2026-11-09T03:32:00Z",
    destination_id: "dest-local",
    destination_name: "Backup volume",
    duration_seconds: 36,
    bytes: gb(1.3),
    snapshot_id: "c61a2d9400000000",
  }),
  run({
    id: "r10",
    kind: "dump",
    status: "succeeded",
    started_at: "2026-11-09T03:30:00Z",
    duration_seconds: 110,
    bytes: gb(1.37),
  }),
  run({
    id: "r11",
    kind: "verify",
    status: "succeeded",
    started_at: "2026-11-08T05:12:00Z",
    destination_id: "dest-gdrive",
    destination_name: "Google Drive",
    duration_seconds: 680,
    details: { read_percent: 5 },
  }),
  run({
    id: "r12",
    kind: "offsite",
    status: "succeeded",
    started_at: "2026-11-07T03:30:00Z",
    destination_id: "dest-local",
    destination_name: "Backup volume",
    duration_seconds: 37,
    bytes: gb(1.29),
    snapshot_id: "5e7f10ab00000000",
  }),
  run({
    id: "r13",
    kind: "restore_drill",
    status: "succeeded",
    started_at: "2026-10-29T04:05:00Z",
    destination_id: "dest-r2",
    destination_name: "Cloudflare R2",
    duration_seconds: 554,
    snapshot_id: "0d4c7a3e00000000",
    details: { rows: { library_tracks: 48212 } },
  }),
];

export function runsPage(offset = 0, limit = 50, items = RUNS): BackupRunList {
  const page = items.slice(offset, offset + limit);
  return {
    items: page,
    total: items.length,
    limit,
    offset,
    has_more: offset + page.length < items.length,
  };
}

export const SNAPSHOTS: BackupSnapshotList = {
  destination_id: "dest-r2",
  listed_at: "2026-11-10T03:37:00Z",
  snapshot_count: 2,
  snapshots: [
    {
      id: "a91f03c2d4e5f6a7b8c9d0e1f2a3b4c5",
      time: "2026-11-10T03:37:12Z",
      host: "crate-scheduled",
      tags: ["daily", "weekly"],
      paths: ["/backups/dumps/crate-20261110-0330.dump"],
    },
    {
      id: "3b8c55e0aa11bb22cc33dd44ee55ff66",
      time: "2026-11-09T03:36:40Z",
      host: "crate-scheduled",
      tags: ["daily"],
      paths: ["/backups/dumps/crate-20261109-0330.dump"],
    },
  ],
};
