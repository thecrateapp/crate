"""Every track-list producer preserves source quality, analysis and duration."""

import json

import pytest
from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope
from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
MEDIA = dict(
    format="flac",
    bitrate=1200000,
    sample_rate=96000,
    bit_depth=24,
    duration=143,
    bpm=99,
    audio_key="D",
    audio_scale="minor",
)


@pytest.fixture
def track(pg_db):
    pg_db.upsert_artist({"name": "Contract Artist"})
    album = pg_db.upsert_album(
        dict(artist="Contract Artist", name="Contract Album", path="/music/contract")
    )
    pg_db.upsert_track(
        dict(
            album_id=album,
            artist="Contract Artist",
            album="Contract Album",
            title="Contract Song",
            filename="01.flac",
            path="/music/contract/01.flac",
            **MEDIA,
        )
    )
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET bpm=99, audio_key='D', audio_scale='minor' WHERE album_id=:id"
            ),
            {"id": album},
        )
    return pg_db.get_library_track_by_path("/music/contract/01.flac")


def _assert_media(row):
    for key, value in MEDIA.items():
        assert row.get(key) == value, (key, row)


def test_search_preserves_quality_and_analysis_in_both_search_shapes(track):
    from crate.db.queries.browse_media_search import search_tracks, search_all_hybrid

    _assert_media(search_tracks("Contract", 10)[0])
    _assert_media(search_all_hybrid("Contract", 10)["tracks"][0])


def test_playlist_detail_preserves_source_quality(track, pg_db):
    playlist_id = pg_db.create_playlist("Contract playlist", user_id=1)
    pg_db.add_playlist_tracks(playlist_id, [dict(track_id=track["id"])])
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks

    _assert_media(get_playlist_tracks(playlist_id)[0])


def test_liked_track_preserves_source_quality(track):
    from crate.db.queries.user_library_library import get_liked_tracks

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO user_liked_tracks (user_id, track_id, created_at) VALUES (1,:id,NOW())"
            ),
            {"id": track["id"]},
        )
    _assert_media(get_liked_tracks(1)[0])


def test_radio_and_similar_batch_enrichment_preserves_metadata_and_explicit_zero(track):
    from crate.db.repositories.library_reference_reads import enrich_track_refs
    from crate.api._deps import enrich_radio_tracks

    _assert_media(enrich_track_refs([track["id"]])[track["id"]])
    rows = enrich_radio_tracks(
        [dict(track_id=track["id"], bpm=0), dict(track_id=track["id"])]
    )
    assert rows[0]["bpm"] == 0
    _assert_media(rows[1])


def test_offline_manifest_preserves_analysis_with_source_quality(track, monkeypatch):
    from crate.api import offline

    monkeypatch.setattr(offline, "get_library_artist", lambda *_: None)
    _assert_media(offline._track_manifest_row(track))


def test_old_saved_path_reads_current_metadata_without_reordering_or_losing_steps(
    track,
):
    from crate.db.queries.paths_store_queries import get_music_path_row

    with transaction_scope() as session:
        path_id = session.execute(
            text("""
            INSERT INTO music_paths (user_id,name,origin_type,origin_value,origin_label,dest_type,dest_value,dest_label,step_count,tracks)
            VALUES (1,'Contract path','track','1','Start','track','2','End',2,CAST(:tracks AS jsonb)) RETURNING id
        """),
            {
                "tracks": json.dumps(
                    [
                        dict(step=0, track_id=track["id"], distance=0.3),
                        dict(step=1, track_id=track["id"], distance=0.7),
                    ]
                )
            },
        ).scalar_one()
    path = get_music_path_row(path_id, 1)
    assert [row["distance"] for row in path["tracks"]] == [0.3, 0.7]
    for row in path["tracks"]:
        _assert_media(row)


@pytest.mark.parametrize("source_only", [False, True])
def test_global_search_artist_album_and_radio_preserve_local_metadata(
    track, source_only
):
    from crate.federation.global_reconciliation import reconcile_local_catalog
    from crate.db.queries import global_catalog
    from crate.db.global_catalog_search_projection import (
        upsert_global_catalog_search_document,
    )

    reconcile_local_catalog()
    with read_scope() as session:
        uid, artist_uid, album_uid = session.execute(
            text(
                "SELECT global_track_uid::text, global_artist_uid::text, global_album_uid::text FROM global_catalog_tracks WHERE local_track_id=:id"
            ),
            {"id": track["id"]},
        ).one()
    if source_only:
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE global_catalog_sources SET source_payload_json = source_payload_json || CAST(:media AS jsonb) WHERE entity_type='track' AND global_entity_uid=CAST(:uid AS uuid)"
                ),
                {"media": json.dumps(MEDIA), "uid": uid},
            )
            session.execute(
                text(
                    "UPDATE global_catalog_tracks SET local_track_id=NULL, local_track_entity_uid=NULL WHERE global_track_uid=CAST(:uid AS uuid)"
                ),
                {"uid": uid},
            )
    upsert_global_catalog_search_document("track", uid)
    # Test the persisted document read by both FastAPI and Go, and the compatibility query.
    with read_scope() as session:
        doc = session.execute(
            text(
                "SELECT payload_json FROM global_catalog_search_documents WHERE entity_type='track' AND global_entity_uid=CAST(:id AS uuid)"
            ),
            {"id": uid},
        ).scalar_one()
    _assert_media(doc)
    _assert_media(
        global_catalog._search_global_catalog_legacy("Contract", 10)["tracks"][0]
    )
    _assert_media(global_catalog.get_global_artist_page(artist_uid)["top_tracks"][0])
    album_track = global_catalog.get_global_album_detail(album_uid)["tracks"][0]
    assert album_track["length_sec"] == MEDIA["duration"]
    assert album_track["bpm"] == 99 and album_track["audio_key"] == "D"
    radio = global_catalog.get_global_radio_seed_tracks("track", uid, limit=10)
    _assert_media(radio["tracks"][0])
    from crate.db.repositories.crates import create_crate, add_crate_album
    from crate.db.queries.crates import get_crate_playback_tracks

    crate_id = create_crate(1, "Metadata crate")
    add_crate_album(crate_id, album_uid, added_by=1)
    _assert_media(get_crate_playback_tracks(crate_id)[0])
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_tracks import add_playlist_tracks

    playlist_id = create_playlist("Global metadata", user_id=1)
    add_playlist_tracks(playlist_id, [{"global_track_uid": uid}])
    _assert_media(get_playlist_tracks(playlist_id)[0])
    from crate.db.queries.user_library_library import get_liked_tracks

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO user_global_track_likes (user_id, global_track_uid, created_at) VALUES (1,CAST(:uid AS uuid),NOW())"
            ),
            {"uid": uid},
        )
    _assert_media(get_liked_tracks(1)[0])


@pytest.mark.parametrize(
    "model_name",
    [
        "TrackRefResponse",
        "LikedTrackResponse",
        "PlaylistTrackResponse",
        "HomeTrackResponse",
        "StatsTrackResponse",
        "RadioTrack",
        "OfflineManifestTrackResponse",
        "CratePlaybackTrackResponse",
    ],
)
def test_list_response_schemas_preserve_complete_source_metadata(model_name):
    from importlib import import_module

    modules = {
        "TrackRefResponse": "media",
        "PlaylistTrackResponse": "playlists",
        "RadioTrack": "radio",
        "OfflineManifestTrackResponse": "offline",
        "CratePlaybackTrackResponse": "crates",
    }
    model = getattr(
        import_module("crate.api.schemas." + modules.get(model_name, "me")), model_name
    )
    row = dict(
        id=7,
        track_id=7,
        title="Contract Song",
        artist="Contract Artist",
        album="Contract Album",
        play_count=2,
        complete_play_count=1,
        minutes_listened=5,
        global_track_uid="track",
        global_album_uid="album",
        global_artist_uid="artist",
        stream_url="/stream",
        download_url="/download",
        **MEDIA,
    )
    payload = model.model_validate(row).model_dump()
    _assert_media(payload)


def test_shaped_radio_payload_preserves_source_quality():
    from crate.radio_engine import _global_radio_track_payload

    _assert_media(
        _global_radio_track_payload(dict(title="Source", artist="Artist", **MEDIA))
    )
