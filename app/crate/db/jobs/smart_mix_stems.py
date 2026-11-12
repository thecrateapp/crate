"""The server's stem work: claims, outcomes and stem files (Smart Mix Stems, ST2.PR3).

``analyze_playlist_stems`` takes one ``track_stem_jobs`` row at a time. A job can be
claimed while one of its track's Smart Mix playlists is on and the track has a current
profile of the revision the job asks for (the analysis is stored under that revision):

- ``pending`` jobs, oldest request first;
- then ``failed`` jobs with attempts left, once ``retry_after_seconds`` times their
  attempts have passed since they failed.

A claim moves the job to ``analyzing``; it ends ``ready`` (the analysis and the stem file
stored in one transaction) or ``failed`` with one more attempt and the error. A job left
``analyzing`` by a separation that died is failed by :func:`release_interrupted_stem_jobs`
and the attempt counts, so a track that keeps killing its worker runs out of attempts.

``track_stem_files`` keeps one stem file per track. The quota evicts the files of tracks
in no Smart Mix playlist that is on first, then the rest, each by least recent use: the
later of the file's last download and its playlists' last use.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text

from crate.db.repositories.smart_mix_stems import upsert_stem_analysis
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.stems import StemAnalysis

# A track counts while one of its Smart Mix playlists is on.
_HELD = """
    EXISTS (
        SELECT 1
        FROM playlist_tracks pt
        JOIN smart_mix_playlists smp
          ON smp.playlist_id = pt.playlist_id AND smp.enabled
        WHERE pt.track_id = job.track_id
    )
"""

_CLAIMABLE = f"""
    FROM track_stem_jobs job
    JOIN track_mix_profiles profile
      ON profile.track_id = job.track_id
     AND profile.source_stale_at IS NULL
     AND profile.source_revision = job.source_revision
    WHERE (
        job.state = 'pending'
        OR (
            job.state = 'failed'
            AND job.attempts < :max_attempts
            AND job.finished_at
                <= NOW() - make_interval(secs => :retry_after_seconds * job.attempts)
        )
    )
      AND {_HELD}
"""


@dataclass(frozen=True, slots=True)
class StemJobClaim:
    track_id: int
    entity_uid: str | None
    path: str
    source_revision: str
    attempts: int
    duration_seconds: float | None


@dataclass(frozen=True, slots=True)
class StemFileRecord:
    """A stem file written under the stems directory, ``path`` relative to it."""

    path: str
    bytes: int
    separator_model: str
    separator_version: str
    source_revision: str


def claim_stem_job(
    *, max_attempts: int, retry_after_seconds: int
) -> StemJobClaim | None:
    """Move the next claimable job to ``analyzing`` and return it, or None."""
    statement = text(
        f"""
        WITH candidate AS (
            SELECT job.track_id
            {_CLAIMABLE}
            ORDER BY job.state = 'failed', job.requested_at, job.track_id
            LIMIT 1
            FOR UPDATE OF job SKIP LOCKED
        )
        UPDATE track_stem_jobs AS job
        SET state = 'analyzing', started_at = NOW(), finished_at = NULL
        FROM candidate, library_tracks lt
        WHERE job.track_id = candidate.track_id AND lt.id = job.track_id
        RETURNING job.track_id, lt.entity_uid::text AS entity_uid, lt.path,
                  job.source_revision, job.attempts, lt.duration
        """
    )
    with transaction_scope() as session:
        row = (
            session.execute(
                statement,
                {
                    "max_attempts": max_attempts,
                    "retry_after_seconds": retry_after_seconds,
                },
            )
            .mappings()
            .first()
        )
    if row is None:
        return None
    return StemJobClaim(
        track_id=int(row["track_id"]),
        entity_uid=row["entity_uid"],
        path=str(row["path"]),
        source_revision=str(row["source_revision"]),
        attempts=int(row["attempts"]),
        duration_seconds=None if row["duration"] is None else float(row["duration"]),
    )


def count_claimable_stem_jobs(*, max_attempts: int, retry_after_seconds: int) -> int:
    statement = text(f"SELECT COUNT(*) {_CLAIMABLE}")
    with read_scope() as session:
        return int(
            session.execute(
                statement,
                {
                    "max_attempts": max_attempts,
                    "retry_after_seconds": retry_after_seconds,
                },
            ).scalar_one()
        )


def stem_jobs_waiting_for_profiles(*, limit: int) -> list[int]:
    """Pending jobs of Smart Mix playlists that are on whose track has no current
    profile (never analysed, or its file changed): they wait for one."""
    statement = text(
        f"""
        SELECT job.track_id
        FROM track_stem_jobs job
        LEFT JOIN track_mix_profiles profile
               ON profile.track_id = job.track_id
              AND profile.source_stale_at IS NULL
        WHERE job.state = 'pending'
          AND profile.track_id IS NULL
          AND {_HELD}
        ORDER BY job.requested_at, job.track_id
        LIMIT :limit
        """
    )
    with read_scope() as session:
        return [
            int(track_id)
            for track_id in session.execute(statement, {"limit": limit}).scalars()
        ]


def fail_stem_job(
    track_id: int, error: str, *, max_attempts: int, final: bool = False
) -> None:
    """Settle an ``analyzing`` job as failed; ``final`` uses up its attempts."""
    statement = text(
        """
        UPDATE track_stem_jobs
        SET state = 'failed',
            attempts = CASE
                WHEN :final THEN GREATEST(attempts + 1, :max_attempts)
                ELSE attempts + 1
            END,
            last_error = LEFT(:error, 1000),
            finished_at = NOW()
        WHERE track_id = :track_id AND state = 'analyzing'
        """
    )
    with transaction_scope() as session:
        session.execute(
            statement,
            {
                "track_id": track_id,
                "error": error,
                "final": final,
                "max_attempts": max_attempts,
            },
        )


def release_interrupted_stem_jobs(*, older_than_seconds: int) -> int:
    """Fail the jobs left ``analyzing`` longer than a separation may run."""
    statement = text(
        """
        UPDATE track_stem_jobs
        SET state = 'failed',
            attempts = attempts + 1,
            last_error = 'The separation stopped before it finished',
            finished_at = NOW()
        WHERE state = 'analyzing'
          AND started_at < NOW() - make_interval(secs => :seconds)
        """
    )
    with transaction_scope() as session:
        result = session.execute(statement, {"seconds": older_than_seconds})
        return int(getattr(result, "rowcount", 0) or 0)


_RECORD_FILE = text(
    """
    WITH previous AS (
        SELECT path FROM track_stem_files WHERE track_id = :track_id
    )
    INSERT INTO track_stem_files AS kept (
        track_id, path, bytes, separator_model, separator_version, source_revision,
        created_at, last_used_at
    ) VALUES (
        :track_id, :path, :bytes, :separator_model, :separator_version,
        :source_revision, NOW(), NOW()
    )
    ON CONFLICT (track_id) DO UPDATE SET
        path = EXCLUDED.path,
        bytes = EXCLUDED.bytes,
        separator_model = EXCLUDED.separator_model,
        separator_version = EXCLUDED.separator_version,
        source_revision = EXCLUDED.source_revision,
        created_at = NOW(),
        last_used_at = NOW()
    RETURNING (SELECT path FROM previous) AS previous_path
    """
)

_FINISH = text(
    """
    UPDATE track_stem_jobs
    SET state = 'ready', last_error = NULL, finished_at = NOW()
    WHERE track_id = :track_id AND state = 'analyzing'
    """
)


def complete_stem_job(
    track_id: int, analysis: StemAnalysis, *, stem_file: StemFileRecord | None
) -> str | None:
    """Store the server's analysis and stem file and mark the job ``ready``, at once.

    Returns the path of the file the new one replaced, if it had another, for the
    caller to delete.
    """
    with transaction_scope() as session:
        upsert_stem_analysis(
            track_id, analysis, producer_kind="server", session=session
        )
        previous: str | None = None
        if stem_file is not None:
            previous = session.execute(
                _RECORD_FILE,
                {
                    "track_id": track_id,
                    "path": stem_file.path,
                    "bytes": stem_file.bytes,
                    "separator_model": stem_file.separator_model,
                    "separator_version": stem_file.separator_version,
                    "source_revision": stem_file.source_revision,
                },
            ).scalar_one_or_none()
        session.execute(_FINISH, {"track_id": track_id})
    if stem_file is None or previous == stem_file.path:
        return None
    return previous


_EVICT = text(
    """
    WITH used AS (
        SELECT file.track_id, file.path, file.bytes,
               EXISTS (
                   SELECT 1
                   FROM playlist_tracks pt
                   JOIN smart_mix_playlists smp
                     ON smp.playlist_id = pt.playlist_id AND smp.enabled
                   WHERE pt.track_id = file.track_id
               ) AS held,
               GREATEST(
                   file.last_used_at,
                   (
                       SELECT MAX(smp.last_used_at)
                       FROM playlist_tracks pt
                       JOIN smart_mix_playlists smp
                         ON smp.playlist_id = pt.playlist_id
                       WHERE pt.track_id = file.track_id
                   )
               ) AS used_at
        FROM track_stem_files file
    ),
    ordered AS (
        SELECT track_id, path, bytes,
               SUM(bytes) OVER () AS total,
               SUM(bytes) OVER (
                   ORDER BY held, used_at, track_id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) - bytes AS earlier_bytes
        FROM used
    ),
    evicted AS (
        SELECT track_id, path FROM ordered WHERE total - earlier_bytes > :limit_bytes
    )
    DELETE FROM track_stem_files file
    USING evicted
    WHERE file.track_id = evicted.track_id AND file.path = evicted.path
    RETURNING file.path, file.bytes
    """
)


def evict_stem_files(limit_bytes: int) -> list[tuple[str, int]]:
    """Delete the rows of the files to evict until the total fits ``limit_bytes``.

    Returns their paths and sizes, for the caller to delete the files.
    """
    with transaction_scope() as session:
        # One eviction at a time, so two never pick from the same total.
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('smart_mix_stem_files'))")
        )
        return [
            (str(row["path"]), int(row["bytes"]))
            for row in session.execute(
                _EVICT, {"limit_bytes": max(0, int(limit_bytes))}
            ).mappings()
        ]


def stem_file_paths() -> set[str]:
    with read_scope() as session:
        return set(session.execute(text("SELECT path FROM track_stem_files")).scalars())


__all__ = [
    "StemFileRecord",
    "StemJobClaim",
    "claim_stem_job",
    "complete_stem_job",
    "count_claimable_stem_jobs",
    "evict_stem_files",
    "fail_stem_job",
    "release_interrupted_stem_jobs",
    "stem_file_paths",
    "stem_jobs_waiting_for_profiles",
]
