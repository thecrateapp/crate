"""Error inbox: Sentry issues synced into Crate and the validated output of their triage.

Both tables stay small (hundreds of rows). Resolved or ignored issues are purged 30
days after they closed (`closed_at`) and their triage goes with them.

`error_issue_triage.invocation_id` points at `ai_invocations` without a foreign key:
migration 130 owns the AI tables and must stay reversible on its own, and a triage
result outlives the retention of its invocation record.
"""


def create_error_inbox_v143_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS error_issues (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider TEXT NOT NULL DEFAULT 'sentry' CHECK (provider IN ('sentry')),
            external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
            short_id TEXT NOT NULL CHECK (length(short_id) BETWEEN 1 AND 128),
            project_slug TEXT NOT NULL CHECK (length(project_slug) BETWEEN 1 AND 100),
            service TEXT NOT NULL CHECK (length(service) BETWEEN 1 AND 100),
            title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
            culprit TEXT CHECK (culprit IS NULL OR length(culprit) <= 300),
            level TEXT NOT NULL CHECK (level IN ('fatal', 'error', 'warning', 'info', 'debug')),
            status TEXT NOT NULL CHECK (status IN ('unresolved', 'resolved', 'ignored')),
            substatus TEXT CHECK (substatus IS NULL OR length(substatus) <= 64),
            sentry_priority TEXT CHECK (
                sentry_priority IS NULL OR sentry_priority IN ('high', 'medium', 'low')
            ),
            issue_category TEXT CHECK (issue_category IS NULL OR length(issue_category) <= 32),
            events_total BIGINT NOT NULL DEFAULT 0 CHECK (events_total >= 0),
            users_total BIGINT NOT NULL DEFAULT 0 CHECK (users_total >= 0),
            events_24h INTEGER NOT NULL DEFAULT 0 CHECK (events_24h >= 0),
            users_24h INTEGER NOT NULL DEFAULT 0 CHECK (users_24h >= 0),
            first_seen TIMESTAMPTZ,
            last_seen TIMESTAMPTZ,
            first_release TEXT CHECK (first_release IS NULL OR length(first_release) <= 300),
            last_release TEXT CHECK (last_release IS NULL OR length(last_release) <= 300),
            permalink TEXT CHECK (
                permalink IS NULL OR (length(permalink) <= 2048 AND permalink LIKE 'https://%')
            ),
            group_key TEXT CHECK (group_key IS NULL OR length(group_key) <= 64),
            digest JSONB,
            digest_event_id TEXT CHECK (digest_event_id IS NULL OR length(digest_event_id) <= 64),
            digest_hash TEXT CHECK (digest_hash IS NULL OR length(digest_hash) <= 64),
            crate_score INTEGER NOT NULL DEFAULT 0,
            fix_requested_at TIMESTAMPTZ,
            fix_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            closed_at TIMESTAMPTZ,
            synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (provider, external_id)
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_error_issues_status_score
        ON error_issues (status, crate_score DESC)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_error_issues_group_key
        ON error_issues (group_key)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_error_issues_last_seen
        ON error_issues (last_seen DESC)
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS error_issue_triage (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            issue_id UUID NOT NULL REFERENCES error_issues(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('triage', 'investigation')),
            digest_hash TEXT NOT NULL CHECK (length(digest_hash) BETWEEN 1 AND 64),
            invocation_id UUID,
            classification TEXT NOT NULL CHECK (
                classification IN (
                    'bug', 'infrastructure', 'external_dependency', 'client_environment', 'noise'
                )
            ),
            severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
            duplicate_of UUID REFERENCES error_issues(id) ON DELETE SET NULL,
            summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 600),
            hypothesis TEXT CHECK (hypothesis IS NULL OR length(hypothesis) <= 1200),
            suspected_frames JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
                jsonb_typeof(suspected_frames) = 'array'
            ),
            next_step TEXT CHECK (next_step IS NULL OR length(next_step) <= 400),
            confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (issue_id, kind, digest_hash)
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_error_issue_triage_issue
        ON error_issue_triage (issue_id, created_at DESC)
    """)


__all__ = ["create_error_inbox_v143_schema"]
