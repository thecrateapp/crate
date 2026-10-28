from dataclasses import asdict
from unittest.mock import MagicMock

from crate import equalizer
from crate.db.queries import equalizer_curves
from crate.db.repositories.equalizer_presets import TrackEqualizerContext


def _track_context(energy=None):
    return TrackEqualizerContext(
        track_id=10,
        track_entity_uid="11111111-1111-1111-1111-111111111111",
        album_id=20,
        album_entity_uid="22222222-2222-2222-2222-222222222222",
        title="Track",
        artist="Artist",
        album="Album",
        energy=energy,
        loudness=None,
        dynamic_range=None,
        spectral_complexity=None,
        danceability=None,
        valence=None,
        acousticness=None,
        instrumentalness=None,
    )


def test_inventory_uses_one_read_and_limits_private_presets_to_user():
    session = MagicMock()
    row = {
        "context": asdict(_track_context()),
        "presets": [],
        "album_genres": [],
        "artist_genres": [],
    }
    session.execute.return_value.mappings.return_value.first.return_value = row
    assert (
        equalizer_curves.get_track_eq_curve_context(10, user_id=7, session=session)
        == row
    )
    session.execute.assert_called_once()
    sql, params = session.execute.call_args.args
    assert params == {"track_id": 10, "user_id": 7}
    assert "p.user_id = :user_id" in str(sql)
    assert "p.user_id IS NULL" in str(sql)


def test_available_curves_preserve_priority_and_show_only_present_candidates(
    monkeypatch,
):
    data = {
        "context": asdict(_track_context(energy=0.9)),
        "presets": [
            {
                "scope": "instance",
                "target_type": "album",
                "gains": [2] * 10,
                "label": "Album curve",
                "reasoning": "",
            },
            {
                "scope": "user",
                "target_type": "track",
                "gains": [3] * 10,
                "label": "My curve",
                "reasoning": "",
            },
        ],
        "album_genres": [],
        "artist_genres": [],
    }
    monkeypatch.setattr(
        equalizer, "get_track_eq_curve_context", lambda *args, **kwargs: data
    )
    curves = equalizer.available_track_eq_curves(10, user_id=7)
    assert [c["source"] for c in curves] == [
        "user_track_preset",
        "instance_album_preset",
        "audio_analysis_preset",
        "flat",
    ]
    assert curves[0]["gains"] == [3] * 10
    assert curves[-1]["gains"] == [0] * 10


def test_inventory_reports_real_genre_and_no_analysis_when_missing(monkeypatch):
    data = {
        "context": asdict(_track_context()),
        "presets": [],
        "album_genres": [{"name": "Rock"}],
        "artist_genres": [],
    }
    monkeypatch.setattr(
        equalizer, "get_track_eq_curve_context", lambda *args, **kwargs: data
    )
    monkeypatch.setattr(
        equalizer,
        "_pick_primary_genre",
        lambda rows, **kwargs: (
            {"primary": {"slug": "rock", "name": "Rock"}, "preset": {"gains": [1] * 10}}
            if rows
            else None
        ),
    )
    curves = equalizer.available_track_eq_curves(10, user_id=7)
    assert [c["source"] for c in curves] == ["genre_taxonomy_preset", "flat"]
    assert curves[0]["genre"] == {"slug": "rock", "name": "Rock"}


def test_missing_track_has_no_inventory(monkeypatch):
    monkeypatch.setattr(
        equalizer, "get_track_eq_curve_context", lambda *args, **kwargs: None
    )
    assert equalizer.available_track_eq_curves(999, user_id=7) is None


def test_local_curve_endpoint_is_authenticated_and_returns_only_inventory(
    test_app, monkeypatch
):
    from crate.api import browse_media

    calls = []
    monkeypatch.setattr(
        browse_media,
        "available_track_eq_curves",
        lambda track_id, **kwargs: (
            calls.append((track_id, kwargs))
            or [
                {
                    "source": "flat",
                    "gains": [0] * 10,
                    "label": "",
                    "reasoning": "",
                    "genre": None,
                }
            ]
        ),
    )
    response = test_app.get("/api/tracks/10/eq/curves")
    assert response.status_code == 200
    assert response.json()[0]["source"] == "flat"
    assert calls[0][0] == 10 and calls[0][1]["user_id"] > 0


def test_missing_curve_endpoint_track_is_404(test_app, monkeypatch):
    from crate.api import browse_media

    monkeypatch.setattr(
        browse_media, "available_track_eq_curves", lambda *args, **kwargs: None
    )
    assert test_app.get("/api/tracks/999/eq/curves").status_code == 404


def test_inventory_sql_is_private_and_handles_real_postgres(pg_db):
    from crate.db.tx import read_scope
    from sqlalchemy import text

    with read_scope() as session:
        # Transaction-local shadow tables keep this contract independent of library seed data.
        for table in [
            "library_tracks",
            "library_albums",
            "equalizer_presets",
            "album_genres",
            "artist_genres",
            "genres",
        ]:
            session.execute(
                text(
                    f"CREATE TEMP TABLE {table} AS SELECT * FROM public.{table} LIMIT 0"
                )
            )
        session.execute(
            text(
                "INSERT INTO library_albums(id,entity_uid,artist) VALUES (20,'22222222-2222-2222-2222-222222222222','Artist')"
            )
        )
        session.execute(
            text(
                "INSERT INTO library_tracks(id,entity_uid,album_id,artist) VALUES (10,'11111111-1111-1111-1111-111111111111',20,'Artist')"
            )
        )
        session.execute(
            text("""INSERT INTO equalizer_presets(scope,target_type,target_entity_uid,user_id,gains,label) VALUES
            ('user','track','11111111-1111-1111-1111-111111111111',7,ARRAY[1.0,1,1,1,1,1,1,1,1,1],'mine'),
            ('user','track','11111111-1111-1111-1111-111111111111',8,ARRAY[2.0,2,2,2,2,2,2,2,2,2],'private'),
            ('instance','album','22222222-2222-2222-2222-222222222222',NULL,ARRAY[3.0,3,3,3,3,3,3,3,3,3],'album')""")
        )
        result = equalizer_curves.get_track_eq_curve_context(
            10, user_id=7, session=session
        )
        assert {p["label"] for p in result["presets"]} == {"mine", "album"}
        assert result["context"]["track_id"] == 10
        assert (
            equalizer_curves.get_track_eq_curve_context(999, user_id=7, session=session)
            is None
        )


def test_entity_curve_endpoint_resolves_local_id(test_app, monkeypatch):
    from crate.api import browse_media

    monkeypatch.setattr(browse_media, "get_track_id_by_entity_uid", lambda uid: 10)
    monkeypatch.setattr(
        browse_media, "available_track_eq_curves", lambda *args, **kwargs: []
    )
    assert test_app.get("/api/tracks/by-entity/track-uid/eq/curves").json() == []


def test_catalog_curve_endpoint_local_and_remote(test_app, monkeypatch):
    from crate.api import browse_media, catalog

    monkeypatch.setattr(
        catalog, "get_global_track_info", lambda uid: {"local_track_id": 10}
    )
    monkeypatch.setattr(
        browse_media, "available_track_eq_curves", lambda *args, **kwargs: []
    )
    assert test_app.get("/api/catalog/tracks/track-uid/eq/curves").json() == []
    monkeypatch.setattr(
        catalog, "get_global_track_info", lambda uid: {"local_track_id": None}
    )
    assert test_app.get("/api/catalog/tracks/remote-uid/eq/curves").json() == []
    monkeypatch.setattr(catalog, "get_global_track_info", lambda uid: None)
    assert test_app.get("/api/catalog/tracks/missing/eq/curves").status_code == 404


def test_curve_openapi_contract(test_app):
    spec = test_app.get("/openapi.json").json()
    for path in [
        "/api/tracks/{track_id}/eq/curves",
        "/api/tracks/by-entity/{entity_uid}/eq/curves",
        "/api/catalog/tracks/{global_track_uid}/eq/curves",
    ]:
        operation = spec["paths"][path]["get"]
        assert operation.get("security")
        assert operation["responses"]["200"]["content"]["application/json"]["schema"][
            "items"
        ]["$ref"].endswith("/EqCurveResponse")


def test_inventory_guard_rejects_anonymous_before_read(test_app, monkeypatch):
    from crate.api import browse_media
    from fastapi import HTTPException

    def deny(request):
        raise HTTPException(status_code=401, detail="Authentication required")

    read = MagicMock()
    monkeypatch.setattr(browse_media, "_require_auth", deny)
    monkeypatch.setattr(browse_media, "available_track_eq_curves", read)
    assert test_app.get("/api/tracks/10/eq/curves").status_code == 401
    read.assert_not_called()
