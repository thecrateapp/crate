"""Persistence and claim fencing for generated Cast spectrum artefacts."""

from __future__ import annotations

from datetime import timedelta
import uuid

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope


CAST_SPECTRUM_FORMAT_VERSION = 1
CAST_SPECTRUM_CLAIM_TTL = timedelta(minutes=20)


def _artifact_from_row(row) -> dict | None:
    if row is None:
        return None
    artifact = dict(row)
    if artifact.get("generation_token") is not None:
        artifact["generation_token"] = str(artifact["generation_token"])
    return artifact


def _generation_token(value: str) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def get_cast_spectrum_artifact(track_id: int) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM cast_spectrum_artifacts
                    WHERE track_id = :track_id
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .first()
        )
    return _artifact_from_row(row)


def ensure_cast_spectrum_request(
    track_id: int,
    source_fingerprint: str,
    *,
    session=None,
) -> dict:
    """Ensure current metadata exists and report whether work should be queued."""
    with optional_scope(session) as active_session:
        row = (
            active_session.execute(
                text(
                    """
                    SELECT *
                    FROM cast_spectrum_artifacts
                    WHERE track_id = :track_id
                    FOR UPDATE
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            row = (
                active_session.execute(
                    text(
                        """
                        INSERT INTO cast_spectrum_artifacts (
                            track_id, source_fingerprint, format_version, status
                        ) VALUES (
                            :track_id, :source_fingerprint, :format_version, 'pending'
                        )
                        RETURNING *
                        """
                    ),
                    {
                        "track_id": track_id,
                        "source_fingerprint": source_fingerprint,
                        "format_version": CAST_SPECTRUM_FORMAT_VERSION,
                    },
                )
                .mappings()
                .one()
            )
        elif row["source_fingerprint"] != source_fingerprint:
            row = (
                active_session.execute(
                    text(
                        """
                        UPDATE cast_spectrum_artifacts
                        SET source_fingerprint = :source_fingerprint,
                            format_version = :format_version,
                            status = 'pending',
                            generation_token = NULL,
                            artifact_path = NULL,
                            artifact_etag = NULL,
                            sample_interval_ms = NULL,
                            band_count = NULL,
                            frame_count = NULL,
                            duration_ms = NULL,
                            byte_size = NULL,
                            failure_count = 0,
                            last_error = NULL,
                            claimed_at = NULL,
                            updated_at = NOW()
                        WHERE track_id = :track_id
                        RETURNING *
                        """
                    ),
                    {
                        "track_id": track_id,
                        "source_fingerprint": source_fingerprint,
                        "format_version": CAST_SPECTRUM_FORMAT_VERSION,
                    },
                )
                .mappings()
                .one()
            )

    result = dict(row)
    result["should_enqueue"] = result["status"] == "pending"
    return result


def claim_cast_spectrum_generation(
    track_id: int,
    source_fingerprint: str,
    *,
    generation_token: str | None = None,
    session=None,
) -> dict | None:
    token = (
        _generation_token(generation_token)
        if generation_token is not None
        else str(uuid.uuid4())
    )
    if token is None:
        raise ValueError("Invalid Cast spectrum generation token")
    with optional_scope(session) as active_session:
        row = (
            active_session.execute(
                text(
                    """
                    UPDATE cast_spectrum_artifacts
                    SET status = 'generating',
                        generation_token = CAST(:generation_token AS uuid),
                        claimed_at = NOW(),
                        last_error = NULL,
                        updated_at = NOW()
                    WHERE track_id = :track_id
                      AND source_fingerprint = :source_fingerprint
                      AND (
                          status IN ('pending', 'failed')
                          OR (
                              status = 'generating'
                              AND (
                                  generation_token = CAST(:generation_token AS uuid)
                                  OR claimed_at < NOW() - :claim_ttl
                              )
                          )
                      )
                    RETURNING *
                    """
                ),
                {
                    "track_id": track_id,
                    "source_fingerprint": source_fingerprint,
                    "generation_token": token,
                    "claim_ttl": CAST_SPECTRUM_CLAIM_TTL,
                },
            )
            .mappings()
            .first()
        )
    return _artifact_from_row(row)


def complete_cast_spectrum_generation(
    track_id: int,
    source_fingerprint: str,
    generation_token: str,
    *,
    artifact_path: str,
    artifact_etag: str,
    frame_count: int,
    duration_ms: int,
    byte_size: int,
    session=None,
) -> bool:
    token = _generation_token(generation_token)
    if token is None:
        return False
    with optional_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                UPDATE cast_spectrum_artifacts
                SET status = 'ready',
                    generation_token = NULL,
                    artifact_path = :artifact_path,
                    artifact_etag = :artifact_etag,
                    sample_interval_ms = 100,
                    band_count = 24,
                    frame_count = :frame_count,
                    duration_ms = :duration_ms,
                    byte_size = :byte_size,
                    last_error = NULL,
                    claimed_at = NULL,
                    updated_at = NOW()
                WHERE track_id = :track_id
                  AND source_fingerprint = :source_fingerprint
                  AND status = 'generating'
                  AND generation_token = CAST(:generation_token AS uuid)
                """
            ),
            {
                "track_id": track_id,
                "source_fingerprint": source_fingerprint,
                "generation_token": token,
                "artifact_path": artifact_path,
                "artifact_etag": artifact_etag,
                "frame_count": frame_count,
                "duration_ms": duration_ms,
                "byte_size": byte_size,
            },
        )
    return result.rowcount == 1


def fail_cast_spectrum_generation(
    track_id: int,
    source_fingerprint: str,
    generation_token: str,
    error: str,
    *,
    session=None,
) -> bool:
    token = _generation_token(generation_token)
    if token is None:
        return False
    with optional_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                UPDATE cast_spectrum_artifacts
                SET status = 'failed',
                    generation_token = NULL,
                    failure_count = failure_count + 1,
                    last_error = :error,
                    claimed_at = NULL,
                    updated_at = NOW()
                WHERE track_id = :track_id
                  AND source_fingerprint = :source_fingerprint
                  AND status = 'generating'
                  AND generation_token = CAST(:generation_token AS uuid)
                """
            ),
            {
                "track_id": track_id,
                "source_fingerprint": source_fingerprint,
                "generation_token": token,
                "error": str(error)[:1000],
            },
        )
    return result.rowcount == 1


def release_cast_spectrum_generation(
    track_id: int,
    source_fingerprint: str,
    generation_token: str,
    *,
    session=None,
) -> bool:
    token = _generation_token(generation_token)
    if token is None:
        return False
    with optional_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                UPDATE cast_spectrum_artifacts
                SET status = 'pending',
                    generation_token = NULL,
                    last_error = NULL,
                    claimed_at = NULL,
                    updated_at = NOW()
                WHERE track_id = :track_id
                  AND source_fingerprint = :source_fingerprint
                  AND status = 'generating'
                  AND generation_token = CAST(:generation_token AS uuid)
                """
            ),
            {
                "track_id": track_id,
                "source_fingerprint": source_fingerprint,
                "generation_token": token,
            },
        )
    return result.rowcount == 1


def mark_cast_spectrum_missing(
    track_id: int,
    source_fingerprint: str,
    *,
    session=None,
) -> bool:
    with optional_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                UPDATE cast_spectrum_artifacts
                SET status = 'pending',
                    artifact_path = NULL,
                    artifact_etag = NULL,
                    sample_interval_ms = NULL,
                    band_count = NULL,
                    frame_count = NULL,
                    duration_ms = NULL,
                    byte_size = NULL,
                    updated_at = NOW()
                WHERE track_id = :track_id
                  AND source_fingerprint = :source_fingerprint
                  AND status = 'ready'
                """
            ),
            {
                "track_id": track_id,
                "source_fingerprint": source_fingerprint,
            },
        )
    return result.rowcount == 1
