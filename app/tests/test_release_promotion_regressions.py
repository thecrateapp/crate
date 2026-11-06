from datetime import date

import pytest

from crate.worker_handlers import acquisition


def _tracklist(count):
    return [
        {"title": f"Track {index}", "position": index} for index in range(1, count + 1)
    ]


@pytest.fixture
def promotion_calls(monkeypatch):
    calls = {"downloaded": [], "downloading": [], "sources": [], "tasks": []}
    cursor_cache = {}
    monkeypatch.setattr(acquisition, "get_cache", cursor_cache.get)
    monkeypatch.setattr(
        acquisition,
        "set_cache",
        lambda key, value, **kwargs: cursor_cache.update({key: value}),
    )
    monkeypatch.setattr(acquisition, "get_setting", lambda _key, default: default)
    monkeypatch.setattr(acquisition, "emit_progress", lambda *a, **k: None)
    monkeypatch.setattr(acquisition, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(acquisition, "is_cancelled", lambda _id: False)
    monkeypatch.setattr(
        acquisition, "mark_release_downloaded", calls["downloaded"].append
    )
    monkeypatch.setattr(
        acquisition, "mark_release_downloading", calls["downloading"].append
    )
    monkeypatch.setattr(
        acquisition,
        "set_new_release_tidal_source",
        lambda release_id, **kw: calls["sources"].append((release_id, kw)),
    )
    monkeypatch.setattr(
        acquisition,
        "create_task_dedup",
        lambda task_type, params, **kw: (
            calls["tasks"].append((task_type, params)) or "download"
        ),
    )
    return calls


def test_tidal_source_match_rejects_other_artists_and_homonymous_single(monkeypatch):
    from crate import tidal

    monkeypatch.setattr(
        tidal,
        "search",
        lambda *a, **k: {
            "albums": [
                {
                    "id": "wrong",
                    "title": "Chosen Hell",
                    "artist": "Another Artist",
                    "tracks": 11,
                    "url": "https://tidal.com/album/1",
                },
                {
                    "id": "single",
                    "title": "Chosen Hell",
                    "artist": "Comeback Kid",
                    "tracks": 1,
                    "url": "https://tidal.com/album/2",
                },
                {
                    "id": "full",
                    "title": "Chosen Hell",
                    "artist": "Comeback Kid",
                    "tracks": 11,
                    "url": "https://tidal.com/album/3",
                },
            ]
        },
    )

    match = acquisition._find_tidal_release_match(
        "Comeback Kid", "Chosen Hell", expected_tracks=11, release_type="Album"
    )

    assert match["tidal_id"] == "full"


def test_register_keeps_full_tracklist_count_and_rejects_preview_source(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        acquisition,
        "_find_tidal_release_match",
        lambda *a, **k: {
            "tidal_url": "https://tidal.com/album/1",
            "tidal_id": "1",
            "cover_url": "",
            "tracks": 1,
            "quality": "",
        },
    )
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_release_group_tracklist", lambda _id: _tracklist(11)
    )
    monkeypatch.setattr(
        acquisition, "_get_tidal_release_tracklist", lambda _id: _tracklist(1)
    )
    monkeypatch.setattr(
        acquisition,
        "_find_tidal_preview_tracks",
        lambda *a: {"preview_tracks": [], "cover_url": "", "quality": ""},
    )
    monkeypatch.setattr(
        acquisition, "upsert_new_release", lambda **kw: captured.update(kw) or 1
    )
    monkeypatch.setattr(
        acquisition, "merge_new_release_preview_tracks", lambda *a, **k: None
    )
    monkeypatch.setattr(
        acquisition, "_broadcast_release_cache_invalidation", lambda *a: None
    )
    monkeypatch.setattr(acquisition, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(
        acquisition, "_find_cover_art_archive_release_group_cover", lambda *a: ""
    )

    acquisition._register_new_release(
        "task",
        "Comeback Kid",
        {
            "title": "Chosen Hell",
            "type": "Album",
            "mbid": "full-group",
            "first_release_date": "2026-11-06",
        },
        "2026-11-06",
        "2026-08-27",
        False,
    )

    assert captured["tracks"] == 11
    assert captured["tidal_url"] == ""
    assert captured["tidal_id"] == ""


def test_promotion_does_not_treat_single_as_complete_album(
    monkeypatch, promotion_calls
):
    release = {
        "id": 7528,
        "artist_name": "Comeback Kid",
        "album_title": "Chosen Hell",
        "release_type": "Album",
        "tracks": 1,
        "tracklist_json": _tracklist(11),
        "library_track_count": 1,
        "tidal_url": "https://tidal.com/album/1",
    }
    monkeypatch.setattr(acquisition, "get_due_prereleases", lambda *a, **k: [release])
    monkeypatch.setattr(
        acquisition,
        "_find_tidal_release_match",
        lambda *a, **k: {
            "tidal_url": "https://tidal.com/album/3",
            "tidal_id": "3",
            "tracks": 11,
        },
    )

    result = acquisition._handle_promote_due_releases("task", {}, {})

    assert promotion_calls["downloaded"] == []
    assert result["queued"] == 1
    assert promotion_calls["tasks"][0][1]["url"] == "https://tidal.com/album/3"


def test_promotion_waits_when_only_partial_source_exists(monkeypatch, promotion_calls):
    release = {
        "id": 7528,
        "artist_name": "Comeback Kid",
        "album_title": "Chosen Hell",
        "release_type": "Album",
        "tracks": 1,
        "tracklist_json": _tracklist(11),
        "library_track_count": 1,
        "tidal_url": "https://tidal.com/album/1",
    }
    monkeypatch.setattr(acquisition, "get_due_prereleases", lambda *a, **k: [release])
    monkeypatch.setattr(
        acquisition,
        "_find_tidal_release_match",
        lambda *a, **k: {"tidal_url": "", "tidal_id": "", "tracks": 0},
    )

    result = acquisition._handle_promote_due_releases("task", {}, {})

    assert promotion_calls["downloaded"] == []
    assert promotion_calls["tasks"] == []
    assert result["waiting_for_source"] == 1


def test_upsert_release_count_includes_full_tracklist(pg_db):
    from crate.db.releases import get_new_releases, upsert_new_release

    release_id = upsert_new_release(
        artist_name="Comeback Kid",
        album_title="Chosen Hell",
        tracks=1,
        release_type="Album",
        tracklist=_tracklist(11),
    )
    rows = get_new_releases(limit=100)
    row = next(row for row in rows if row["id"] == release_id)
    assert row["tracks"] == 11


def test_due_prereleases_carries_full_identity(pg_db):
    from sqlalchemy import text
    from crate.db.jobs.acquisition import get_due_prereleases
    from crate.db.releases import upsert_new_release
    from crate.db.tx import transaction_scope

    release_id = upsert_new_release(
        artist_name="Comeback Kid",
        album_title="Chosen Hell",
        tracks=1,
        release_type="Album",
        release_date="2026-11-06",
        mb_release_group_id="full-group",
        tracklist=_tracklist(11),
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE new_releases SET detected_at='2026-08-27' WHERE id=:id"),
            {"id": release_id},
        )
    row = next(
        row
        for row in get_due_prereleases(date(2026, 11, 6), lookback_days=60)
        if row["id"] == release_id
    )
    assert row["release_type"] == "Album"
    assert row["mb_release_group_id"] == "full-group"
    assert len(row["tracklist_json"]) == 11


def test_growing_release_drops_previous_single_source(pg_db):
    from crate.db.releases import get_new_releases, upsert_new_release

    release_id = upsert_new_release(
        artist_name="Comeback Kid",
        album_title="Chosen Hell",
        tracks=1,
        tidal_id="single",
        tidal_url="https://tidal.com/album/1",
        source_name="tidal",
        source_url="https://tidal.com/album/1",
    )
    upsert_new_release(
        artist_name="Comeback Kid",
        album_title="Chosen Hell",
        tracks=11,
        release_type="Album",
        tracklist=_tracklist(11),
    )

    row = next(row for row in get_new_releases(limit=100) if row["id"] == release_id)
    assert row["tidal_url"] == ""
    assert row["tidal_id"] == ""
    assert not row["source_url"]


def test_due_prereleases_recovers_album_falsely_marked_downloaded(pg_db):
    from sqlalchemy import text
    from crate.db.jobs.acquisition import get_due_prereleases
    from crate.db.releases import mark_release_downloaded, upsert_new_release
    from crate.db.tx import transaction_scope

    release_id = upsert_new_release(
        artist_name="Comeback Kid",
        album_title="Chosen Hell",
        tracks=1,
        release_type="Album",
        release_date="2026-11-06",
        tracklist=_tracklist(11),
    )
    mark_release_downloaded(release_id)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE new_releases SET detected_at='2026-08-27' WHERE id=:id"),
            {"id": release_id},
        )
        session.execute(
            text("INSERT INTO library_artists (name) VALUES ('Comeback Kid')")
        )
        session.execute(
            text(
                "INSERT INTO library_albums (artist,name,path,track_count,release_group_primary_type) VALUES ('Comeback Kid','Chosen Hell','/test/chosen-hell',1,'Single')"
            )
        )

    rows = get_due_prereleases(date(2026, 11, 6), lookback_days=60)
    assert [row["id"] for row in rows] == [release_id]


def test_tidal_source_match_requires_artist_and_full_title(monkeypatch):
    from crate import tidal

    monkeypatch.setattr(
        tidal,
        "search",
        lambda *a, **k: {
            "albums": [
                {
                    "id": "unknown-artist",
                    "title": "Chosen Hell",
                    "tracks": 11,
                    "url": "https://tidal.com/album/1",
                },
                {
                    "id": "wrong-title",
                    "title": "Chosen Hell Live",
                    "artist": "Comeback Kid",
                    "tracks": 11,
                    "url": "https://tidal.com/album/2",
                },
            ]
        },
    )

    assert (
        acquisition._find_tidal_release_match(
            "Comeback Kid", "Chosen Hell", expected_tracks=11, release_type="Album"
        )["tidal_url"]
        == ""
    )


def test_tidal_source_match_preserves_known_one_track_album(monkeypatch):
    from crate import tidal

    monkeypatch.setattr(
        tidal,
        "search",
        lambda *a, **k: {
            "albums": [
                {
                    "id": "long-form",
                    "title": "One",
                    "artist": "Artist",
                    "tracks": 1,
                    "url": "https://tidal.com/album/1",
                },
            ]
        },
    )

    assert (
        acquisition._find_tidal_release_match(
            "Artist", "One", expected_tracks=1, release_type="Album"
        )["tidal_id"]
        == "long-form"
    )


def test_tidal_search_preserves_release_type(monkeypatch):
    from types import SimpleNamespace
    from crate import tidal

    response = SimpleNamespace(
        status_code=200,
        raise_for_status=lambda: None,
        json=lambda: {
            "albums": {
                "items": [
                    {
                        "id": "1",
                        "title": "One",
                        "type": "ALBUM",
                        "artists": [{"name": "Artist"}],
                        "numberOfTracks": 1,
                    }
                ]
            }
        },
    )
    monkeypatch.setattr(tidal, "get_auth_token", lambda: "fixture-token")
    monkeypatch.setattr(tidal, "_configured_country_code", lambda: "ES")
    monkeypatch.setattr(tidal.requests, "get", lambda *a, **k: response)

    assert (
        tidal.search("Artist One", content_type="albums")["albums"][0]["type"]
        == "ALBUM"
    )


def test_tidal_source_with_unknown_track_count_is_not_a_download_source(monkeypatch):
    from crate import tidal

    monkeypatch.setattr(
        tidal,
        "search",
        lambda *a, **k: {
            "albums": [
                {
                    "id": "1",
                    "title": "Chosen Hell",
                    "artist": "Comeback Kid",
                    "url": "https://tidal.com/album/1",
                }
            ]
        },
    )

    assert (
        acquisition._find_tidal_release_match("Comeback Kid", "Chosen Hell")[
            "tidal_url"
        ]
        == ""
    )


def test_tidal_source_match_accepts_explicit_album_without_expected_track_count(
    monkeypatch,
):
    from crate import tidal

    monkeypatch.setattr(
        tidal,
        "search",
        lambda *a, **k: {
            "albums": [
                {
                    "id": "long-form",
                    "title": "One",
                    "artist": "Artist",
                    "tracks": 1,
                    "type": "ALBUM",
                    "url": "https://tidal.com/album/1",
                }
            ]
        },
    )

    assert (
        acquisition._find_tidal_release_match("Artist", "One", release_type="Album")[
            "tidal_id"
        ]
        == "long-form"
    )


def test_growing_release_preserves_non_tidal_source(pg_db):
    from crate.db.releases import get_new_releases, upsert_new_release

    release_id = upsert_new_release(
        artist_name="Artist",
        album_title="Album",
        tracks=1,
        source_name="bandcamp",
        source_url="https://artist.bandcamp.com/album/album",
    )
    upsert_new_release(
        artist_name="Artist", album_title="Album", tracks=11, tracklist=_tracklist(11)
    )

    row = next(row for row in get_new_releases(limit=100) if row["id"] == release_id)
    assert row["source_url"] == "https://artist.bandcamp.com/album/album"
    assert row["source_name"] == "bandcamp"


def test_promotion_rotates_unavailable_sources_across_runs(
    monkeypatch, promotion_calls
):
    releases = [
        {
            "id": index,
            "artist_name": "Artist",
            "album_title": f"Album {index}",
            "release_type": "Album",
            "tracks": 11,
            "library_track_count": 0,
        }
        for index in range(1, 13)
    ]
    monkeypatch.setattr(
        acquisition,
        "get_due_prereleases",
        lambda *a, **k: sorted(
            releases,
            key=lambda row: (row["id"] <= k.get("after_release_id", 0), row["id"]),
        ),
    )
    monkeypatch.setattr(
        acquisition,
        "_find_tidal_release_match",
        lambda artist, title, **kw: {
            "tidal_url": f"https://tidal.com/album/{title.split()[-1]}"
            if int(title.split()[-1]) > 10
            else "",
            "tidal_id": title.split()[-1],
            "tracks": 11,
        },
    )

    first = acquisition._handle_promote_due_releases("first", {}, {})
    second = acquisition._handle_promote_due_releases("second", {}, {})

    assert first["queued"] == 0
    assert second["queued"] == 2
    assert [params["new_release_id"] for _, params in promotion_calls["tasks"]] == [
        11,
        12,
    ]


def test_due_prereleases_rotates_past_first_hundred_candidates(pg_db):
    from sqlalchemy import text
    from crate.db.jobs.acquisition import get_due_prereleases
    from crate.db.releases import upsert_new_release
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        release_ids = [
            upsert_new_release(
                artist_name="Artist",
                album_title=f"Album {index}",
                release_date="2026-11-06",
                tracks=11,
                session=session,
            )
            for index in range(101)
        ]
        session.execute(
            text("UPDATE new_releases SET detected_at='2026-08-27' WHERE id=ANY(:ids)"),
            {"ids": release_ids},
        )
    first = get_due_prereleases(date(2026, 11, 6), lookback_days=60)
    later = get_due_prereleases(
        date(2026, 11, 6), lookback_days=60, after_release_id=release_ids[99]
    )

    assert len(first) == len(later) == 100
    assert first[0]["id"] == release_ids[0]
    assert later[0]["id"] == release_ids[100]
    assert later[1]["id"] == release_ids[0]


def test_tidal_source_match_preserves_symbol_only_artist_names(monkeypatch):
    from crate import tidal

    monkeypatch.setattr(
        tidal,
        "search",
        lambda *a, **k: {
            "albums": [
                {
                    "id": "1",
                    "title": "Album",
                    "artist": "!!!",
                    "tracks": 11,
                    "type": "ALBUM",
                    "url": "https://tidal.com/album/1",
                }
            ]
        },
    )

    assert (
        acquisition._find_tidal_release_match(
            "!!!", "Album", expected_tracks=11, release_type="Album"
        )["tidal_id"]
        == "1"
    )
