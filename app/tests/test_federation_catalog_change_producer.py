from __future__ import annotations

from sqlalchemy import text


class _Result:
    def __init__(self, row=None):
        self._row = row

    def mappings(self):
        return self

    def first(self):
        return self._row


class _Session:
    def __init__(self, payload=None):
        self.payload = payload
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params=None):
        sql = str(statement)
        values = params or {}
        self.calls.append((sql, values))
        if "AS payload" in sql:
            return _Result({"payload": self.payload} if self.payload else None)
        return _Result()


def test_local_dirty_source_emits_one_idempotent_shareable_change(monkeypatch):
    from crate.db.repositories import global_catalog_dirty_sources as dirty

    session = _Session(
        {
            "entity_type": "artist",
            "remote_entity_uid": "artist-1",
            "title": "High Vis",
        }
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup", lambda *args, **kwargs: None
    )

    dirty.enqueue_local_dirty_source(
        "artist",
        "artist-1",
        "upsert",
        session=session,
    )

    change_calls = [
        call
        for call in session.calls
        if "INSERT INTO federation_catalog_changes" in call[0]
    ]
    assert len(change_calls) == 1
    assert "ON CONFLICT" in change_calls[0][0]
    assert change_calls[0][1]["entity_uid"] == "artist-1"
    assert change_calls[0][1]["operation"] == "upsert"


def test_delete_emits_tombstone_without_loading_current_payload(monkeypatch):
    from crate.db.repositories import global_catalog_dirty_sources as dirty

    session = _Session()
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup", lambda *args, **kwargs: None
    )

    dirty.enqueue_local_dirty_source(
        "album",
        "album-1",
        "delete",
        session=session,
        source_revision="revision-7",
    )

    change = next(
        call
        for call in session.calls
        if "INSERT INTO federation_catalog_changes" in call[0]
    )
    assert change[1]["operation"] == "delete"
    assert change[1]["payload_revision"] == "revision-7"
    assert "deleted" in change[1]["payload_json"]


def test_local_delta_album_payload_preserves_artwork_facets(pg_db):
    del pg_db
    from crate.db.jobs.federation_catalog_changes import load_local_catalog_payload
    from crate.db.tx import transaction_scope

    artist_uid = "11111111-1111-4111-8111-111111111111"
    album_uid = "22222222-2222-4222-8222-222222222222"
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, entity_uid, updated_at)
                VALUES ('High Vis', CAST(:artist_uid AS uuid), NOW())
                """
            ),
            {"artist_uid": artist_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO library_albums (
                    artist, name, path, entity_uid, has_cover,
                    release_group_primary_type, release_group_secondary_types,
                    updated_at
                )
                VALUES (
                    'High Vis', 'Blending', '/music/high-vis/blending',
                    CAST(:album_uid AS uuid), 1,
                    'Album', '["Compilation"]'::jsonb, NOW()
                )
                """
            ),
            {"album_uid": album_uid},
        )

        payload = load_local_catalog_payload(session, "album", album_uid)

    assert payload is not None
    assert payload["has_cover"] is True
    assert payload["release_group_primary_type"] == "Album"
    assert payload["release_group_secondary_types"] == ["Compilation"]
    assert payload["facets"]["metadata"]["available"] is True
    assert payload["facets"]["album_detail"]["available"] is True
    assert payload["facets"]["album_artwork"]["available"] is True
