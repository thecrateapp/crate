// Synthetic Error Inbox data for tests and the local preview. Modelled on the
// shape of real triage (a regressed IntegrityError in the library pipeline, a
// group of duplicate fetch failures, a readplane 502, an Android crash), with
// invented identifiers, paths and payloads: no library names, no real events.

import type {
  Digest,
  ErrorFixRun,
  ErrorIssueDetail,
  ErrorIssueFix,
  ErrorIssueSummary,
  ErrorSummary,
  ErrorTrackingConnection,
  ErrorTriage,
  FixConnection,
  SyncState,
} from "@/lib/error-inbox";

const MINUTE = 60_000;

/** ISO timestamp `minutes` before `now`. */
export function minutesAgo(minutes: number, now = Date.now()): string {
  return new Date(now - minutes * MINUTE).toISOString();
}

export function sampleIssue(
  overrides: Partial<ErrorIssueSummary> = {},
): ErrorIssueSummary {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    short_id: "CRATE-API-1",
    title: "Sample issue",
    culprit: null,
    service: "api",
    project_slug: "crate-api",
    level: "error",
    status: "unresolved",
    substatus: "ongoing",
    issue_category: "error",
    sentry_priority: "medium",
    events_24h: 1,
    users_24h: 0,
    events_total: 1,
    users_total: 0,
    first_seen: minutesAgo(600),
    last_seen: minutesAgo(30),
    first_release: "crate-0000000",
    last_release: "crate-0000000",
    crate_score: 40,
    critical: false,
    group_key: null,
    permalink: "https://sentry.example.test/issues/1/",
    fix_requested_at: null,
    synced_at: minutesAgo(3),
    classification: null,
    severity: null,
    ...overrides,
  };
}

export function sampleIssues(now = Date.now()): ErrorIssueSummary[] {
  return [
    sampleIssue({
      id: "4b0c1f52-6a1e-4d8e-9a51-0d3f6c1e2a01",
      short_id: "CRATE-WORKERS-3K",
      title:
        'IntegrityError: duplicate key value violates unique constraint "library_tracks_path_key"',
      culprit: "crate.library_pipeline in persist_album",
      service: "worker-maintenance",
      project_slug: "crate-workers",
      level: "error",
      substatus: "regressed",
      sentry_priority: "high",
      events_24h: 140,
      users_24h: 0,
      events_total: 1_212,
      users_total: 0,
      first_seen: minutesAgo(60 * 24 * 19, now),
      last_seen: minutesAgo(4, now),
      first_release: "crate-5c5bd24",
      last_release: "crate-8e1f0a7",
      crate_score: 91,
      critical: true,
      group_key: "IntegrityError|crate/library_pipeline.py:persist_album",
      permalink: "https://sentry.example.test/issues/3001/",
      classification: "bug",
      severity: "high",
    }),
    sampleIssue({
      id: "7d2e9a10-3b44-4f7c-8c2d-5e6f7a8b9c02",
      short_id: "CRATE-READPLANE-2D",
      title: "UpstreamUnavailable: api-unavailable (502)",
      culprit: "internal/proxy.(*Fallback).ServeHTTP",
      service: "readplane",
      project_slug: "crate-readplane",
      level: "error",
      substatus: "escalating",
      sentry_priority: "medium",
      events_24h: 320,
      users_24h: 14,
      events_total: 2_048,
      users_total: 31,
      first_seen: minutesAgo(60 * 24 * 6, now),
      last_seen: minutesAgo(2, now),
      first_release: "crate-5c5bd24",
      last_release: "crate-8e1f0a7",
      crate_score: 93,
      critical: true,
      group_key: "UpstreamUnavailable|internal/proxy/fallback.go:ServeHTTP",
      permalink: "https://sentry.example.test/issues/3002/",
      classification: "infrastructure",
      severity: "critical",
    }),
    sampleIssue({
      id: "c3a8e6d4-1f20-4b9e-a7c3-2d1e0f9a8b03",
      short_id: "CRATE-LISTEN-9F",
      title:
        "java.lang.IllegalStateException: MediaSession was released before playback resumed",
      culprit: "app.crate.listen.PlaybackService.onResume",
      service: "listen",
      project_slug: "crate-listen",
      level: "fatal",
      substatus: "new",
      sentry_priority: "medium",
      events_24h: 3,
      users_24h: 2,
      events_total: 3,
      users_total: 2,
      first_seen: minutesAgo(180, now),
      last_seen: minutesAgo(41, now),
      first_release: "crate-android-1.42.0",
      last_release: "crate-android-1.42.0",
      crate_score: 90,
      critical: true,
      group_key: "IllegalStateException|PlaybackService.kt:onResume",
      permalink: "https://sentry.example.test/issues/3003/",
    }),
    sampleIssue({
      id: "e5f6a7b8-9c0d-4e1f-8a2b-3c4d5e6f7a04",
      short_id: "CRATE-LISTEN-7A",
      title: "TypeError: Failed to fetch",
      culprit: "apiFetch(src/lib/api.ts)",
      service: "listen",
      project_slug: "crate-listen",
      level: "error",
      substatus: "ongoing",
      sentry_priority: "low",
      events_24h: 12,
      users_24h: 3,
      events_total: 418,
      users_total: 57,
      first_seen: minutesAgo(60 * 24 * 40, now),
      last_seen: minutesAgo(9, now),
      first_release: "crate-5c5bd24",
      last_release: "crate-8e1f0a7",
      crate_score: 63,
      group_key: "TypeError|src/lib/api.ts:apiFetch",
      permalink: "https://sentry.example.test/issues/3004/",
      classification: "client_environment",
      severity: "low",
    }),
    sampleIssue({
      id: "f6a7b8c9-0d1e-4f2a-9b3c-4d5e6f7a8b05",
      short_id: "CRATE-LISTEN-7C",
      title: "TypeError: Failed to fetch",
      culprit: "apiFetch(src/lib/api.ts)",
      service: "listen",
      project_slug: "crate-listen",
      level: "error",
      substatus: "ongoing",
      sentry_priority: "low",
      events_24h: 7,
      users_24h: 2,
      events_total: 96,
      users_total: 18,
      first_seen: minutesAgo(60 * 24 * 21, now),
      last_seen: minutesAgo(26, now),
      first_release: "crate-5c5bd24",
      last_release: "crate-8e1f0a7",
      crate_score: 58,
      group_key: "TypeError|src/lib/api.ts:apiFetch",
      permalink: "https://sentry.example.test/issues/3005/",
    }),
    sampleIssue({
      id: "a7b8c9d0-1e2f-4a3b-8c4d-5e6f7a8b9c06",
      short_id: "CRATE-LISTEN-81",
      title: "TypeError: Failed to fetch",
      culprit: "apiFetch(src/lib/api.ts)",
      service: "listen",
      project_slug: "crate-listen",
      level: "error",
      substatus: "new",
      sentry_priority: "low",
      events_24h: 2,
      users_24h: 1,
      events_total: 2,
      users_total: 1,
      first_seen: minutesAgo(300, now),
      last_seen: minutesAgo(70, now),
      first_release: "crate-8e1f0a7",
      last_release: "crate-8e1f0a7",
      crate_score: 51,
      group_key: "TypeError|src/lib/api.ts:apiFetch",
      permalink: "https://sentry.example.test/issues/3006/",
    }),
    sampleIssue({
      id: "b8c9d0e1-2f3a-4b4c-9d5e-6f7a8b9c0d07",
      short_id: "CRATE-ADMIN-12",
      title: "ResizeObserver loop completed with undelivered notifications",
      culprit: null,
      service: "admin",
      project_slug: "crate-admin",
      level: "warning",
      substatus: "ongoing",
      sentry_priority: "low",
      events_24h: 5,
      users_24h: 1,
      events_total: 77,
      users_total: 2,
      first_seen: minutesAgo(60 * 24 * 30, now),
      last_seen: minutesAgo(180, now),
      first_release: "crate-5c5bd24",
      last_release: "crate-8e1f0a7",
      crate_score: 24,
      group_key: null,
      permalink: "https://sentry.example.test/issues/3007/",
      classification: "noise",
      severity: "low",
    }),
  ];
}

export function sampleSync(overrides: Partial<SyncState> = {}): SyncState {
  return {
    status: "ok",
    started_at: minutesAgo(4),
    finished_at: minutesAgo(3),
    last_success_at: minutesAgo(3),
    error_code: null,
    counts: {
      listed: 7,
      listed_recent: 5,
      upserted: 7,
      digests_fetched: 3,
      status_refreshed: 0,
      purged: 0,
    },
    truncated: { full: false, recent: false },
    ...overrides,
  };
}

export function sampleSummary(
  overrides: Partial<ErrorSummary> = {},
  issues = sampleIssues(),
): ErrorSummary {
  const open = issues.filter((issue) => issue.status === "unresolved");
  const services = new Map<string, ErrorSummary["services"][number]>();
  for (const issue of open) {
    const entry = services.get(issue.service) ?? {
      service: issue.service,
      open: 0,
      critical: 0,
      new_24h: 0,
      regressed_24h: 0,
    };
    entry.open += 1;
    if (issue.critical) entry.critical += 1;
    if (issue.substatus === "new") entry.new_24h += 1;
    if (issue.substatus === "regressed") entry.regressed_24h += 1;
    services.set(issue.service, entry);
  }
  const critical = open
    .filter((issue) => issue.critical)
    .sort((a, b) => b.crate_score - a.crate_score);
  return {
    configured: true,
    open: open.length,
    critical_open: critical.length,
    new_24h: open.filter((issue) => issue.substatus === "new").length,
    regressed_24h: open.filter((issue) => issue.substatus === "regressed")
      .length,
    untriaged: open.filter((issue) => !issue.classification).length,
    pending_review: issues.filter((issue) => issue.fix_status === "pr_open")
      .length,
    last_synced_at: minutesAgo(3),
    services: [...services.values()].sort((a, b) =>
      a.service.localeCompare(b.service),
    ),
    top_critical: critical.slice(0, 3).map((issue) => ({
      id: issue.id,
      short_id: issue.short_id,
      title: issue.title,
      service: issue.service,
      crate_score: issue.crate_score,
    })),
    sync: sampleSync(),
    ...overrides,
  };
}

export const NOT_CONFIGURED_SUMMARY: ErrorSummary = {
  configured: false,
  open: 0,
  critical_open: 0,
  new_24h: 0,
  regressed_24h: 0,
  untriaged: 0,
  pending_review: 0,
  last_synced_at: null,
  services: [],
  top_critical: [],
  sync: null,
};

export function sampleDigest(): Digest {
  return {
    v: 1,
    event_id: "9f3c2b1a0e8d4c7b6a5f4e3d2c1b0a99",
    platform: "python",
    release: "crate-8e1f0a7",
    message: null,
    exceptions: [
      {
        type: "UniqueViolation",
        value:
          'duplicate key value violates unique constraint "library_tracks_path_key"',
        module: "psycopg.errors",
        mechanism: null,
        handled: null,
      },
      {
        type: "IntegrityError",
        value:
          '(psycopg.errors.UniqueViolation) duplicate key value violates unique constraint "library_tracks_path_key"',
        module: "sqlalchemy.exc",
        mechanism: "dramatiq",
        handled: false,
      },
    ],
    frames: [
      {
        module: "crate.worker_handlers.library",
        function: "_handle_process_new_content",
        filename: "crate/worker_handlers/library.py",
        lineno: 212,
        context: [
          [209, "    batch = scan_batch(params)"],
          [210, "    for album in batch.albums:"],
          [211, "        emit_progress(task_id, album.position, batch.total)"],
          [212, "        persist_album(album, session=session)"],
          [213, '    return {"albums": len(batch.albums)}'],
        ],
      },
      {
        module: "crate.library_pipeline",
        function: "persist_album",
        filename: "crate/library_pipeline.py",
        lineno: 388,
        context: [
          [384, "    tracks = [track_row(item) for item in album.tracks]"],
          [385, "    # The scanner may report the same file twice when a move"],
          [386, "    # finishes between the directory walk and the tag read."],
          [
            387,
            '    log.debug("Persisting %d tracks from /music/<path>", len(tracks))',
          ],
          [388, "    upsert_tracks(tracks, session=session)"],
          [389, "    refresh_album_stats(album.id, session=session)"],
          [390, ""],
        ],
      },
      {
        module: "crate.db.repositories.library_tracks",
        function: "upsert_tracks",
        filename: "crate/db/repositories/library_tracks.py",
        lineno: 141,
        context: [
          [137, "def upsert_tracks(rows, *, session):"],
          [138, "    statement = insert(library_tracks).values(rows)"],
          [139, "    statement = statement.on_conflict_do_update("],
          [
            140,
            "        index_elements=[library_tracks.c.id], set_=_updatable(rows))",
          ],
          [141, "    session.execute(statement)"],
          [142, "    return len(rows)"],
        ],
      },
    ],
    tags: {
      service: "worker-maintenance",
      environment: "production",
      release: "crate-8e1f0a7",
      runtime: "CPython 3.13.1",
      task_type: "process_new_content",
    },
    breadcrumbs: [
      {
        category: "task",
        level: "info",
        message: "process_new_content started",
      },
      {
        category: "scanner",
        level: "info",
        message: "Scanning /music/<path>",
      },
      {
        category: "query",
        level: "info",
        message: "SELECT id, path FROM library_tracks WHERE path = ANY(:paths)",
      },
      {
        category: "scanner",
        level: "warning",
        message: "File moved during scan: /music/<path>",
      },
      {
        category: "query",
        level: "error",
        message: "INSERT INTO library_tracks (...) ON CONFLICT (id) DO UPDATE",
      },
    ],
    truncated: false,
  };
}

export function sampleDetail(
  overrides: Partial<ErrorIssueDetail> = {},
): ErrorIssueDetail {
  const [issue] = sampleIssues();
  return {
    ...issue!,
    provider: "sentry",
    external_id: "3001",
    digest: sampleDigest(),
    digest_event_id: "9f3c2b1a0e8d4c7b6a5f4e3d2c1b0a99",
    digest_hash: "4f9a1c7e2b3d5a60",
    fix_requested_by: null,
    fix_requested_by_name: null,
    closed_at: null,
    created_at: minutesAgo(60 * 24 * 19),
    triages: [],
    auto_triage_queued_at: null,
    write_access: true,
    fix: null,
    fix_runs: [],
    ...overrides,
  };
}

/** A fix run whose draft pull request waits for review, checks skipped. */
export function sampleFixRun(
  overrides: Partial<ErrorFixRun> = {},
): ErrorFixRun {
  return {
    id: "f1a00000-0000-4000-8000-000000000001",
    executor: "github_actions",
    status: "pr_open",
    repository: "thecrateapp/crate",
    base_ref: "main",
    external_run_id: "18800000001",
    external_run_url:
      "https://github.com/thecrateapp/crate/actions/runs/18800000001",
    branch: "autofix/crate-api-1-18800000001",
    pr_number: 412,
    pr_url: "https://github.com/thecrateapp/crate/pull/412",
    pr_state: "open",
    pr_draft: true,
    pr_mergeable: true,
    pr_mergeable_state: "draft",
    pr_head_sha: "3b1f0c9d2e4a5b6c7d8e9f00112233445566778a",
    pr_author: "crate-error-autofix[bot]",
    pr_labeled: true,
    ci_state: "success",
    requested_by: 1,
    requested_by_name: "Diego",
    requested_at: minutesAgo(50),
    started_at: minutesAgo(45),
    pr_opened_at: minutesAgo(20),
    merge_requested_by_name: null,
    merge_requested_at: null,
    ready_at: null,
    finished_at: null,
    checked_at: minutesAgo(2),
    error_code: null,
    summary: null,
    cleanup_state: "none",
    review: { can_merge: true, blockers: [], can_discard: true },
    ...overrides,
  };
}

/** A validated triage of the sample digest, as the detail lists it. */
export function sampleTriage(
  overrides: Partial<ErrorTriage> = {},
): ErrorTriage {
  return {
    id: "a1b2c3d4-0000-4000-8000-00000000aa01",
    kind: "triage",
    digest_hash: "4f9a1c7e2b3d5a60",
    invocation_id: "a1b2c3d4-0000-4000-8000-00000000bb01",
    classification: "bug",
    severity: "high",
    duplicate_of: null,
    summary:
      "Persisting an album fails when the scanner reports the same file twice.",
    hypothesis:
      "persist_album upserts by id, so a moved file arrives with a new id and the same path.",
    suspected_frames: [1, 2],
    next_step:
      "Upsert library_tracks on path in upsert_tracks and add a test with a moved file.",
    confidence: 0.82,
    model: "gemini-2.5-flash",
    created_at: minutesAgo(20),
    ...overrides,
  };
}

const ACTIONS_URL =
  "https://github.com/thecrateapp/crate/actions/workflows/error-autofix.yml";

/** Launch fix as the detail carries it when it is configured. */
export function sampleFix(
  overrides: Partial<ErrorIssueFix> = {},
): ErrorIssueFix {
  return {
    repository: "thecrateapp/crate",
    workflow: "error-autofix.yml",
    executor: "github_actions",
    actions_url: ACTIONS_URL,
    supported: true,
    available_at: null,
    ...overrides,
  };
}

/** Launch fix as the connection carries it. */
export function sampleFixConnection(
  overrides: Partial<FixConnection> = {},
): FixConnection {
  return {
    repository: "thecrateapp/crate",
    workflow: "error-autofix.yml",
    ref: "main",
    executor: "github_actions",
    has_token: true,
    actions_url: ACTIONS_URL,
    ...overrides,
  };
}

export function sampleConnection(
  overrides: Partial<ErrorTrackingConnection> = {},
): ErrorTrackingConnection {
  return {
    configured: true,
    provider: "sentry",
    base_url: "https://sentry.io",
    organization: "example-org",
    projects: ["crate-api", "crate-workers", "crate-readplane", "crate-listen"],
    environments: ["production"],
    has_token: true,
    access: {
      read: true,
      write: true,
      checked_at: minutesAgo(3),
      source: "sync",
      error_code: null,
    },
    sync: sampleSync(),
    fix: null,
    triage: { automatic: false, daily_max: 30 },
    ...overrides,
  };
}

export const NOT_CONFIGURED_CONNECTION: ErrorTrackingConnection = {
  configured: false,
  provider: "sentry",
  base_url: "https://sentry.io",
  organization: null,
  projects: [],
  environments: [],
  has_token: false,
  access: null,
  sync: null,
  fix: null,
  triage: { automatic: false, daily_max: 30 },
};
