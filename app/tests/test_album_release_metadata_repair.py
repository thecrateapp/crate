from __future__ import annotations

from datetime import date, timedelta

import pytest


@pytest.mark.parametrize(
    "selector_name",
    ["get_albums_needing_release_metadata", "get_albums_missing_release_group"],
)
def test_metadata_repair_selects_released_album_with_obsolete_single_identity(
    pg_db, selector_name
):
    from crate.db.jobs import enrichment
    from crate.db.releases import upsert_new_release

    pg_db.upsert_artist({"name": "Comeback Kid"})

    def album(name, primary_type="Single", count=12):
        return pg_db.upsert_album(
            {
                "artist": "Comeback Kid",
                "name": name,
                "path": f"/music/comeback-kid/{name}",
                "track_count": count,
                "musicbrainz_albumid": f"single-release-{name}",
                "musicbrainz_releasegroupid": f"single-group-{name}",
                "release_group_primary_type": primary_type,
                "release_date": "2026-08-27",
            }
        )

    chosen = album("Chosen Hell")
    album("Real EP", "EP", 12)
    album("Same Group", "EP", 12)
    album("Still Upcoming")
    album("Dismissed")
    album("Only The Single", count=1)
    quarantined = album("Quarantined")
    today = date.today()
    for name in (
        "Chosen Hell",
        "Same Group",
        "Still Upcoming",
        "Dismissed",
        "Only The Single",
        "Quarantined",
    ):
        release_id = upsert_new_release(
            "Comeback Kid",
            name,
            tracks=1,
            release_type="Album",
            release_date=str(
                today + timedelta(days=1) if name == "Still Upcoming" else today
            ),
            mb_release_group_id="single-group-Same Group"
            if name == "Same Group"
            else "full-group",
            tracklist=[
                {"title": f"Track {index}", "position": index} for index in range(1, 12)
            ],
        )
        if name == "Dismissed":
            from sqlalchemy import text
            from crate.db.tx import transaction_scope

            with transaction_scope() as session:
                session.execute(
                    text("UPDATE new_releases SET status = 'dismissed' WHERE id = :id"),
                    {"id": release_id},
                )
    from sqlalchemy import text
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET quarantined_at = now() WHERE id = :id"),
            {"id": quarantined},
        )

    selected = getattr(enrichment, selector_name)()

    assert [row["id"] for row in selected] == [chosen]
    assert selected[0]["expected_release_group_id"] == "full-group"


def test_album_rematch_preserves_recording_identity_with_reordered_duplicate_tracks(
    pg_db,
):
    from crate.db.jobs.enrichment import persist_album_release_mbids

    pg_db.upsert_artist({"name": "Comeback Kid"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Comeback Kid",
            "name": "Chosen Hell",
            "path": "/music/comeback-kid/chosen-hell",
            "musicbrainz_albumid": "single-release",
            "musicbrainz_releasegroupid": "single-group",
            "release_group_primary_type": "Single",
            "release_date": "2026-08-27",
        }
    )
    for filename, title, number, duration in (
        ("single.flac", "Chosen Hell", 1, 158.4),
        ("target.flac", "Target On My Back", 1, 168),
        ("album.flac", "Chosen Hell", 6, 158.4),
        ("bonus.flac", "Unrelated Bonus", 12, 230),
    ):
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Comeback Kid",
                "album": "Chosen Hell",
                "path": f"/music/comeback-kid/chosen-hell/{filename}",
                "filename": filename,
                "title": title,
                "track_number": number,
                "duration": duration,
                "format": "flac",
            }
        )
    tracks = pg_db.get_library_tracks(album_id)
    identities = {track["id"]: track["entity_uid"] for track in tracks}
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        complete_dirty_source,
    )
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        for dirty in claim_dirty_sources(100, session=session):
            complete_dirty_source(
                dirty["id"],
                requested_at=dirty["requested_at"],
                claimed_at=dirty["claimed_at"],
                session=session,
            )
    persist_album_release_mbids(
        album_id,
        sorted(tracks, key=lambda track: track["filename"], reverse=True),
        {
            "mbid": "full-release",
            "release_group_id": "full-group",
            "release_group_primary_type": "Album",
            "first_release_date": "2026-11-06",
            "tracks": [
                {
                    "title": "Target on My Back",
                    "length_sec": 168,
                    "mbid": "target-recording",
                },
                {"title": "Chosen Hell", "length_sec": 158, "mbid": "chosen-recording"},
            ],
        },
    )

    album = pg_db.get_library_album_by_id(album_id)
    repaired = pg_db.get_library_tracks(album_id)
    by_filename = {track["filename"]: track for track in repaired}
    assert album["release_group_primary_type"] == "Album"
    assert album["musicbrainz_releasegroupid"] == "full-group"
    assert album["release_date"] == "2026-11-06"
    assert by_filename["single.flac"]["musicbrainz_trackid"] == "chosen-recording"
    assert by_filename["album.flac"]["musicbrainz_trackid"] == "chosen-recording"
    assert by_filename["target.flac"]["musicbrainz_trackid"] == "target-recording"
    assert not by_filename["bonus.flac"]["musicbrainz_trackid"]
    assert {track["id"]: track["entity_uid"] for track in repaired} == identities
    with transaction_scope() as session:
        dirty = claim_dirty_sources(100, session=session)
    assert {(row["entity_type"], str(row["local_entity_uid"])) for row in dirty} == {
        ("album", str(album["entity_uid"])),
        *(
            ("track", str(track["entity_uid"]))
            for track in repaired
            if track["filename"] != "bonus.flac"
        ),
    }


def test_scheduled_repair_uses_confirmed_album_group_and_persists_metadata(
    pg_db, monkeypatch
):
    import musicbrainzngs
    from crate import matcher
    from crate.db.jobs.enrichment import get_albums_missing_release_group
    from crate.db.releases import upsert_new_release
    from crate.worker_handlers import enrichment

    pg_db.upsert_artist({"name": "Comeback Kid"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Comeback Kid",
            "name": "Chosen Hell",
            "path": "/music/comeback-kid/chosen-hell",
            "track_count": 11,
            "musicbrainz_albumid": "single-release",
            "musicbrainz_releasegroupid": "single-group",
            "release_group_primary_type": "Single",
            "release_date": "2026-08-27",
        }
    )
    tracks = [
        {
            "title": f"Recording {index}",
            "length_sec": 150 + index,
            "mbid": f"recording-{index}",
        }
        for index in range(11)
    ]
    for index, track in enumerate(tracks):
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Comeback Kid",
                "album": "Chosen Hell",
                "filename": f"{index}.flac",
                "path": f"/music/comeback-kid/chosen-hell/{index}.flac",
                "title": track["title"],
                "track_number": index + 1,
                "duration": track["length_sec"],
            }
        )
    upsert_new_release(
        "Comeback Kid",
        "Chosen Hell",
        release_type="Album",
        release_date=str(date.today()),
        mb_release_group_id="full-group",
        tracklist=[
            {"title": track["title"], "position": index + 1}
            for index, track in enumerate(tracks)
        ],
    )
    full_release = {
        "mbid": "full-release",
        "release_group_id": "full-group",
        "release_group_primary_type": "Album",
        "title": "Chosen Hell",
        "artist": "Comeback Kid",
        "first_release_date": "2026-11-06",
        "track_count": 11,
        "tracks": tracks,
    }
    monkeypatch.setattr(
        matcher,
        "_get_release_detail",
        lambda mbid: (
            full_release
            if mbid == "full-release"
            else {
                **full_release,
                "release_group_id": "single-group",
                "release_group_primary_type": "Single",
                "track_count": 1,
            }
        ),
    )
    monkeypatch.setattr(
        musicbrainzngs,
        "browse_releases",
        lambda **_kwargs: {"release-list": [{"id": "full-release"}]},
    )
    monkeypatch.setattr(enrichment, "wait_for_provider_slot", lambda *_args: None)
    monkeypatch.setattr(enrichment, "get_setting", lambda *_args: "95")
    monkeypatch.setattr(enrichment, "is_cancelled", lambda *_args: False)
    monkeypatch.setattr(enrichment, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(enrichment, "emit_task_event", lambda *_args: None)
    monkeypatch.setattr(enrichment, "get_cache", lambda *_args: None)
    monkeypatch.setattr(enrichment, "set_cache", lambda *_args, **_kwargs: None)
    invalidations = []
    monkeypatch.setattr(
        enrichment,
        "_broadcast_release_metadata_invalidation",
        lambda: invalidations.append(True),
    )

    result = enrichment._handle_rematch_album_mbids("repair", {}, {})

    assert result["enriched"] == 1
    assert invalidations == [True]
    repaired = pg_db.get_library_album_by_id(album_id)
    assert repaired["musicbrainz_albumid"] == "full-release"
    assert repaired["musicbrainz_releasegroupid"] == "full-group"
    assert repaired["release_group_primary_type"] == "Album"
    assert repaired["release_date"] == "2026-11-06"
    assert get_albums_missing_release_group() == []
