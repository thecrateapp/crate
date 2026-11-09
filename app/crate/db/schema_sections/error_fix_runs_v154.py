"""Error fix runs: each attempt to fix an error issue, whoever runs it.

`dispatch_error_fix` creates a row when a person presses Launch fix; the executor
named in `fix.executor` (`github_actions` today, `factory` later) does the work, and
`track_error_fixes` follows it on GitHub until its pull request is merged or closed.
The lifecycle lives in `crate.error_inbox.fix_runs`; the contract for fixers in
`docs/technical/error-fix-executors.md`.

- At most one open run (`requested`, `running`, `pr_open`) per issue, enforced by a
  partial unique index.
- Rows go with their issue (`ON DELETE CASCADE`): the audit log keeps the record.
- Text columns hold identifiers, GitHub links and a short summary Crate writes or
  sanitizes; never event text, titles or the person's note.
"""

V154_STATUSES = (
    "'requested', 'running', 'pr_open', 'merged', 'closed', 'failed', "
    "'cancelled', 'expired'"
)
V154_OPEN_STATUSES = "'requested', 'running', 'pr_open'"


def create_error_fix_runs_v154_schema(cur) -> None:
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS error_fix_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            issue_id UUID NOT NULL REFERENCES error_issues(id) ON DELETE CASCADE,
            executor TEXT NOT NULL CHECK (executor IN ('github_actions', 'factory')),
            status TEXT NOT NULL DEFAULT 'requested'
                CHECK (status IN ({V154_STATUSES})),
            repository TEXT NOT NULL CHECK (length(repository) BETWEEN 3 AND 201),
            base_ref TEXT CHECK (base_ref IS NULL OR length(base_ref) <= 100),
            external_run_id TEXT
                CHECK (external_run_id IS NULL OR length(external_run_id) <= 128),
            external_run_url TEXT CHECK (
                external_run_url IS NULL
                OR (length(external_run_url) <= 2048
                    AND external_run_url LIKE 'https://%')
            ),
            branch TEXT CHECK (branch IS NULL OR length(branch) <= 255),
            pr_number INTEGER CHECK (pr_number IS NULL OR pr_number > 0),
            pr_url TEXT CHECK (
                pr_url IS NULL
                OR (length(pr_url) <= 2048 AND pr_url LIKE 'https://%')
            ),
            pr_state TEXT CHECK (pr_state IS NULL OR pr_state IN ('open', 'closed', 'merged')),
            pr_draft BOOLEAN,
            pr_mergeable BOOLEAN,
            pr_mergeable_state TEXT
                CHECK (pr_mergeable_state IS NULL OR length(pr_mergeable_state) <= 32),
            pr_head_sha TEXT
                CHECK (pr_head_sha IS NULL OR pr_head_sha ~ '^[0-9a-f]{{40}}$'),
            pr_author TEXT CHECK (pr_author IS NULL OR length(pr_author) <= 100),
            pr_labeled BOOLEAN,
            ci_state TEXT CHECK (
                ci_state IS NULL OR ci_state IN ('pending', 'success', 'failure', 'none')
            ),
            requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at TIMESTAMPTZ,
            pr_opened_at TIMESTAMPTZ,
            merge_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            merge_requested_at TIMESTAMPTZ,
            merge_sha TEXT CHECK (merge_sha IS NULL OR merge_sha ~ '^[0-9a-f]{{40}}$'),
            ready_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            checked_at TIMESTAMPTZ,
            error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 64),
            summary TEXT CHECK (summary IS NULL OR length(summary) <= 280),
            cleanup_state TEXT NOT NULL DEFAULT 'none'
                CHECK (cleanup_state IN ('none', 'pending', 'done', 'failed')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_error_fix_runs_issue
        ON error_fix_runs (issue_id, requested_at DESC)
    """)
    cur.execute(f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_error_fix_runs_open_issue
        ON error_fix_runs (issue_id)
        WHERE status IN ({V154_OPEN_STATUSES})
    """)
    cur.execute(f"""
        CREATE INDEX IF NOT EXISTS idx_error_fix_runs_trackable
        ON error_fix_runs (checked_at NULLS FIRST)
        WHERE status IN ({V154_OPEN_STATUSES}) OR cleanup_state = 'pending'
    """)


def drop_error_fix_runs_v154_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS error_fix_runs")


__all__ = [
    "V154_OPEN_STATUSES",
    "V154_STATUSES",
    "create_error_fix_runs_v154_schema",
    "drop_error_fix_runs_v154_schema",
]
