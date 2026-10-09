from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from crate.db.queries.vdj_catalog import (
    VDJ_FOLDER_TRACK_LIMIT,
    get_vdj_folder_page,
    list_vdj_folders,
    vdj_folder_statement,
)
from crate.db.repositories.auth_user_accounts import create_user
from crate.db.tx import transaction_scope


def test_folder_list_contains_visible_playlists_genres_moods_and_recent(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    owner = _user("owner")
    other = _user("other")
    library = _library(tmp_path, count=12)
    own = _playlist(owner, "Warmup", library.track_ids[:3])
    _playlist(other, "Private Other", library.track_ids[:2])
    shared = _playlist(other, "Shared With Me", library.track_ids[:2])
    _add_member(shared, owner)
    followed = _playlist(other, "Public Followed", library.track_ids[:2], public=True)
    _follow(owner, followed)
    _genre(library.album_id, "post-hardcore")

    folders = {folder["id"]: folder["name"] for folder in list_vdj_folders(owner)}

    assert folders["crate:recently-played"] == "Recently Played"
    assert folders[f"crate:playlist:{own}"] == "Warmup"
    assert folders[f"crate:playlist:{shared}"] == "Shared With Me"
    assert folders[f"crate:playlist:{followed}"] == "Public Followed"
    assert "Private Other" not in folders.values()
    assert "post-hardcore" in folders.values()
    assert folders["crate:mood:happy"] == "Happy"


def test_large_playlists_are_split_into_numbered_parts(pg_db, tmp_path: Path) -> None:
    del pg_db
    owner = _user("parts")
    library = _library(tmp_path, count=VDJ_FOLDER_TRACK_LIMIT + 20)
    playlist_id = _playlist(owner, "Marathon", library.track_ids)

    folders = {folder["id"]: folder["name"] for folder in list_vdj_folders(owner)}
    first = get_vdj_folder_page(f"crate:playlist:{playlist_id}:part:1", user_id=owner)
    second = get_vdj_folder_page(f"crate:playlist:{playlist_id}:part:2", user_id=owner)

    assert folders[f"crate:playlist:{playlist_id}:part:1"] == "Marathon (1/2)"
    assert folders[f"crate:playlist:{playlist_id}:part:2"] == "Marathon (2/2)"
    assert len(first["tracks"]) == VDJ_FOLDER_TRACK_LIMIT
    assert len(second["tracks"]) == 20
    assert first["tracks"][0]["entity_uid"] == library.track_uids[0]
    assert second["tracks"][-1]["entity_uid"] == library.track_uids[-1]
    assert first["next_cursor"] is None


def test_private_playlists_of_other_users_are_not_readable(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    owner = _user("reader")
    other = _user("writer")
    library = _library(tmp_path, count=3)
    private = _playlist(other, "Secret", library.track_ids)

    with pytest.raises(KeyError):
        get_vdj_folder_page(f"crate:playlist:{private}", user_id=owner)


def test_genre_folder_uses_normalized_album_genres(pg_db, tmp_path: Path) -> None:
    del pg_db
    owner = _user("genre")
    tagged = _library(tmp_path, count=4)
    untagged = _library(tmp_path, count=2)
    genre_id = _genre(tagged.album_id, "emo")

    page = get_vdj_folder_page(f"crate:genre:{genre_id}", user_id=owner)

    uids = {track["entity_uid"] for track in page["tracks"]}
    assert uids == set(tagged.track_uids)
    assert not uids & set(untagged.track_uids)


def test_mood_folder_returns_the_strongest_matches_first(pg_db, tmp_path: Path) -> None:
    del pg_db
    owner = _user("mood")
    library = _library(tmp_path, count=5)
    _set_moods(library.track_ids, [0.1, 0.9, 0.55, 0.7, 0.3])

    page = get_vdj_folder_page("crate:mood:happy", user_id=owner)

    assert [track["entity_uid"] for track in page["tracks"]] == [
        library.track_uids[1],
        library.track_uids[3],
        library.track_uids[2],
    ]


def test_recently_played_deduplicates_the_latest_plays(pg_db, tmp_path: Path) -> None:
    del pg_db
    owner = _user("recent")
    library = _library(tmp_path, count=3)
    now = datetime.now(UTC)
    _play(owner, library.track_ids[0], now - timedelta(minutes=30))
    _play(owner, library.track_ids[1], now - timedelta(minutes=20))
    _play(owner, library.track_ids[0], now - timedelta(minutes=10))

    page = get_vdj_folder_page("crate:recently-played", user_id=owner)

    assert [track["entity_uid"] for track in page["tracks"]] == [
        library.track_uids[0],
        library.track_uids[1],
    ]


@pytest.mark.parametrize(
    "folder_id",
    ["crate:playlists", "crate:genres", "crate:mood:unknown", "crate:playlist:x"],
)
def test_unknown_folders_are_rejected(pg_db, folder_id: str) -> None:
    del pg_db
    with pytest.raises(KeyError):
        get_vdj_folder_page(folder_id, user_id=1)


@pytest.mark.parametrize("folder_kind", ["genre", "mood", "recent", "playlist"])
def test_folder_queries_never_scan_library_tracks_at_scale(
    pg_db, tmp_path: Path, folder_kind: str
) -> None:
    del pg_db
    owner = _user(f"scale-{folder_kind}")
    library = _library(tmp_path, count=12_000, albums=200)
    genre_id = _genre(library.album_ids[0], f"scale-{folder_kind}")
    playlist_id = _playlist(owner, "Scale", library.track_ids[:600])
    now = datetime.now(UTC)
    for index, track_id in enumerate(library.track_ids[:50]):
        _play(owner, track_id, now - timedelta(minutes=index))
    folder_id = {
        "genre": f"crate:genre:{genre_id}",
        "mood": "crate:mood:happy",
        "recent": "crate:recently-played",
        "playlist": f"crate:playlist:{playlist_id}:part:2",
    }[folder_kind]
    statement, params = vdj_folder_statement(folder_id, user_id=owner)

    with transaction_scope() as session:
        session.execute(text("ANALYZE library_tracks"))
        session.execute(text("ANALYZE user_play_events"))
        session.execute(text("ANALYZE playlist_tracks"))
        raw_plan = session.execute(
            text(f"EXPLAIN (FORMAT JSON) {statement.text}"), params
        ).scalar_one()

    assert not _has_seq_scan(raw_plan, "library_tracks")


class _Library:
    def __init__(
        self,
        album_ids: list[int],
        track_ids: list[int],
        track_uids: list[str],
    ) -> None:
        self.album_ids = album_ids
        self.album_id = album_ids[0]
        self.track_ids = track_ids
        self.track_uids = track_uids


def _user(name: str) -> int:
    return int(create_user(f"{name}-{uuid.uuid4().hex[:8]}@example.test")["id"])


def _library(tmp_path: Path, *, count: int, albums: int = 1) -> _Library:
    suffix = uuid.uuid4().hex
    artist = f"VDJ Catalog {suffix}"
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists (name, entity_uid) "
                "VALUES (:artist, CAST(:uid AS uuid))"
            ),
            {"artist": artist, "uid": str(uuid.uuid4())},
        )
        album_ids = [
            int(
                session.execute(
                    text(
                        """
                        INSERT INTO library_albums (artist, name, path, entity_uid)
                        VALUES (:artist, :name, :path, CAST(:uid AS uuid))
                        RETURNING id
                        """
                    ),
                    {
                        "artist": artist,
                        "name": f"Album {index}",
                        "path": str(tmp_path / suffix / str(index)),
                        "uid": str(uuid.uuid4()),
                    },
                ).scalar_one()
            )
            for index in range(albums)
        ]
        rows = session.execute(
            text(
                """
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path,
                    entity_uid, duration, track_number
                )
                SELECT
                    (CAST(:album_ids AS integer[]))[1 + (index % :albums)],
                    :artist,
                    'Album',
                    index::text || '.flac',
                    'Track ' || lpad(index::text, 6, '0'),
                    :base_path || '/' || index::text || '.flac',
                    CAST(md5(:suffix || index::text) AS uuid),
                    180.0,
                    index
                FROM generate_series(0, :last_index) AS index
                ORDER BY index
                RETURNING id, entity_uid::text
                """
            ),
            {
                "album_ids": album_ids,
                "albums": albums,
                "artist": artist,
                "base_path": str(tmp_path / suffix),
                "suffix": suffix,
                "last_index": count - 1,
            },
        ).all()
    ordered = sorted(rows, key=lambda row: row[0])
    return _Library(
        album_ids,
        [int(row[0]) for row in ordered],
        [str(row[1]) for row in ordered],
    )


def _playlist(
    owner: int, name: str, track_ids: list[int], *, public: bool = False
) -> int:
    now = datetime.now(UTC)
    with transaction_scope() as session:
        playlist_id = int(
            session.execute(
                text(
                    """
                    INSERT INTO playlists (
                        name, user_id, visibility, track_count,
                        created_at, updated_at
                    )
                    VALUES (:name, :owner, :visibility, :count, :now, :now)
                    RETURNING id
                    """
                ),
                {
                    "name": name,
                    "owner": owner,
                    "visibility": "public" if public else "private",
                    "count": len(track_ids),
                    "now": now,
                },
            ).scalar_one()
        )
        session.execute(
            text(
                """
                INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
                SELECT :playlist_id, track_id, position, :now
                FROM unnest(CAST(:track_ids AS integer[])) WITH ORDINALITY
                    AS item(track_id, position)
                """
            ),
            {"playlist_id": playlist_id, "track_ids": track_ids, "now": now},
        )
    return playlist_id


def _add_member(playlist_id: int, user_id: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO playlist_members (playlist_id, user_id, role, created_at)
                VALUES (:playlist_id, :user_id, 'collab', NOW())
                """
            ),
            {"playlist_id": playlist_id, "user_id": user_id},
        )


def _follow(user_id: int, playlist_id: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_followed_playlists (user_id, playlist_id, followed_at)
                VALUES (:user_id, :playlist_id, NOW())
                """
            ),
            {"user_id": user_id, "playlist_id": playlist_id},
        )


def _genre(album_id: int, name: str) -> int:
    with transaction_scope() as session:
        genre_id = int(
            session.execute(
                text(
                    """
                    INSERT INTO genres (name, slug)
                    VALUES (:name, :slug)
                    ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug
                    RETURNING id
                    """
                ),
                {"name": name, "slug": f"{name}-{uuid.uuid4().hex[:6]}"},
            ).scalar_one()
        )
        session.execute(
            text(
                """
                INSERT INTO album_genres (album_id, genre_id, weight)
                VALUES (:album_id, :genre_id, 1.0)
                ON CONFLICT DO NOTHING
                """
            ),
            {"album_id": album_id, "genre_id": genre_id},
        )
    return genre_id


def _set_moods(track_ids: list[int], happy_scores: list[float]) -> None:
    with transaction_scope() as session:
        for track_id, score in zip(track_ids, happy_scores, strict=True):
            session.execute(
                text(
                    "UPDATE library_tracks SET mood_json = CAST(:mood AS jsonb) "
                    "WHERE id = :track_id"
                ),
                {"track_id": track_id, "mood": json.dumps({"happy": score})},
            )


def _play(user_id: int, track_id: int, ended_at: datetime) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_play_events (
                    user_id, client_event_id, track_id, started_at, ended_at,
                    played_seconds, created_at
                )
                VALUES (
                    :user_id, :event_id, :track_id, :started_at, :ended_at, 120, NOW()
                )
                """
            ),
            {
                "user_id": user_id,
                "event_id": uuid.uuid4().hex,
                "track_id": track_id,
                "started_at": ended_at - timedelta(minutes=2),
                "ended_at": ended_at,
            },
        )


def _has_seq_scan(plan: object, relation: str) -> bool:
    if isinstance(plan, list):
        return any(_has_seq_scan(item, relation) for item in plan)
    if not isinstance(plan, dict):
        return False
    if plan.get("Node Type") == "Seq Scan" and plan.get("Relation Name") == relation:
        return True
    return any(_has_seq_scan(value, relation) for value in plan.values())


def test_mood_index_migration_builds_concurrently_and_matches_the_query() -> None:
    from crate.db.queries.vdj_catalog import VDJ_MOODS, mood_score_expression
    from crate.db.schema_sections.vdj_catalog_v108 import vdj_mood_index_statements

    migration = (
        Path(__file__).resolve().parents[1]
        / "crate/db/migrations/versions/108_vdj_mood_indexes.py"
    ).read_text()
    statements = vdj_mood_index_statements(concurrently=True)

    assert 'down_revision = "107"' in migration
    assert "autocommit_block()" in migration
    assert len(statements) == len(VDJ_MOODS)
    for mood, statement in zip(VDJ_MOODS, statements, strict=True):
        assert statement.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS")
        assert mood_score_expression(mood) in statement
