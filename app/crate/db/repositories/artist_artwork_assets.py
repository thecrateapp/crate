"""Persistence for curated artist artwork assets and slot assignments."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope

ARTIST_ARTWORK_SLOTS = frozenset(
    {"avatar", "background", "hero_desktop", "hero_mobile"}
)


def create_or_get_artist_artwork_asset(
    *,
    artist_id: int,
    checksum: str,
    storage_path: str,
    origin: str,
    label: str,
    mime_type: str,
    width: int,
    height: int,
    session=None,
) -> dict:
    def _write(active_session) -> dict:
        row = (
            active_session.execute(
                text(
                    """
                    INSERT INTO artist_artwork_assets (
                        artist_id, checksum, storage_path, origin, label,
                        mime_type, width, height
                    ) VALUES (
                        :artist_id, :checksum, :storage_path, :origin, :label,
                        :mime_type, :width, :height
                    )
                    ON CONFLICT (artist_id, checksum) DO UPDATE SET
                        storage_path = artist_artwork_assets.storage_path
                    RETURNING id, artist_id, checksum, storage_path, origin,
                              label, mime_type, width, height, created_at
                    """
                ),
                {
                    "artist_id": artist_id,
                    "checksum": checksum,
                    "storage_path": storage_path,
                    "origin": origin,
                    "label": label,
                    "mime_type": mime_type,
                    "width": width,
                    "height": height,
                },
            )
            .mappings()
            .one()
        )
        return dict(row)

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)


def get_artist_artwork_asset(
    artist_id: int, asset_id: int, *, session=None
) -> dict | None:
    def _read(active_session) -> dict | None:
        row = (
            active_session.execute(
                text(
                    """
                    SELECT id, artist_id, checksum, storage_path, origin, label,
                           mime_type, width, height, created_at
                    FROM artist_artwork_assets
                    WHERE id = :asset_id AND artist_id = :artist_id
                    """
                ),
                {"asset_id": asset_id, "artist_id": artist_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _read(session)
    with read_scope() as active_session:
        return _read(active_session)


def list_artist_artwork_assets(artist_id: int, *, session=None) -> list[dict]:
    def _read(active_session) -> list[dict]:
        rows = (
            active_session.execute(
                text(
                    """
                    SELECT asset.id, asset.artist_id, asset.checksum,
                           asset.storage_path, asset.origin, asset.label,
                           asset.mime_type, asset.width, asset.height,
                           asset.created_at,
                           COALESCE(
                               ARRAY_AGG(slot.slot ORDER BY slot.slot)
                                   FILTER (WHERE slot.slot IS NOT NULL),
                               ARRAY[]::TEXT[]
                           ) AS slots
                    FROM artist_artwork_assets asset
                    LEFT JOIN artist_artwork_slots slot
                      ON slot.asset_id = asset.id
                    WHERE asset.artist_id = :artist_id
                    GROUP BY asset.id
                    ORDER BY asset.created_at DESC, asset.id DESC
                    """
                ),
                {"artist_id": artist_id},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _read(session)
    with read_scope() as active_session:
        return _read(active_session)


def delete_artist_artwork_asset(
    *, artist_id: int, asset_id: int, session=None
) -> dict | None:
    """Delete an asset only while no artwork slot references it."""

    def _write(active_session) -> dict | None:
        row = (
            active_session.execute(
                text(
                    """
                    DELETE FROM artist_artwork_assets AS asset
                    WHERE asset.id = :asset_id
                      AND asset.artist_id = :artist_id
                      AND NOT EXISTS (
                          SELECT 1
                          FROM artist_artwork_slots slot
                          WHERE slot.artist_id = asset.artist_id
                            AND slot.asset_id = asset.id
                      )
                    RETURNING asset.id, asset.artist_id, asset.storage_path
                    """
                ),
                {"artist_id": artist_id, "asset_id": asset_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)


def assign_artist_artwork_slot(
    *, artist_id: int, slot: str, asset_id: int, session=None
) -> bool:
    if slot not in ARTIST_ARTWORK_SLOTS:
        raise ValueError(f"Unknown artist artwork slot: {slot}")

    def _write(active_session) -> bool:
        row = active_session.execute(
            text(
                """
                INSERT INTO artist_artwork_slots (artist_id, slot, asset_id)
                SELECT :artist_id, :slot, asset.id
                FROM artist_artwork_assets asset
                WHERE asset.id = :asset_id AND asset.artist_id = :artist_id
                ON CONFLICT (artist_id, slot) DO UPDATE SET
                    asset_id = EXCLUDED.asset_id,
                    updated_at = NOW()
                RETURNING asset_id
                """
            ),
            {"artist_id": artist_id, "slot": slot, "asset_id": asset_id},
        ).first()
        return row is not None

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)
