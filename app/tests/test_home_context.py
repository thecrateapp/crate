from __future__ import annotations

import crate.db.home_context as home_context


def test_recent_releases_from_context_keeps_saved_album_arrivals(monkeypatch):
    monkeypatch.setattr(
        home_context,
        "_cached_new_releases",
        lambda limit=250: [
            {
                "album_id": 112765,
                "artist_name": "Converge",
                "album_title": "Hum of Hurt",
                "release_date": "2026-06-05",
            }
        ],
    )

    rows = home_context.recent_releases_from_context(
        {
            "interest_artists_lower": ["converge"],
            "saved_album_ids": [112765],
        }
    )

    assert [row["album_title"] for row in rows] == ["Hum of Hurt"]


def test_home_context_preserves_global_identity(monkeypatch):
    monkeypatch.setattr(
        home_context,
        "_load_home_context_rows",
        lambda *_args, **_kwargs: {
            "followed": [],
            "saved_albums": [],
            "top_artists": [
                {
                    "artist_name": "High Vis",
                    "artist_id": None,
                    "global_artist_uid": "global-high-vis",
                    "artist_entity_uid": None,
                    "artist_slug": None,
                    "play_count": 7,
                    "complete_play_count": 6,
                    "minutes_listened": 21,
                }
            ],
            "top_albums": [],
            "top_genres": [],
        },
    )

    context = home_context.get_home_context(7)

    assert context["top_artists"][0]["global_artist_uid"] == "global-high-vis"
    assert context["top_artists"][0]["artist_name"] == "High Vis"


def test_home_context_reuses_caller_session_for_fallback_genres(monkeypatch):
    session = object()
    calls: dict[str, object] = {}

    def fake_load_rows(*_args, **kwargs):
        calls["rows_session"] = kwargs["session"]
        return {
            "followed": [{"artist_name": "Artist"}],
            "saved_albums": [],
            "top_artists": [],
            "top_albums": [],
            "top_genres": [],
        }

    def fake_genres(_names, _limit, *, session=None):
        calls["genres_session"] = session
        return ["rock"]

    monkeypatch.setattr(home_context, "_load_home_context_rows", fake_load_rows)
    monkeypatch.setattr(home_context, "get_followed_artist_genre_names", fake_genres)

    home_context.get_home_context(7, session=session)

    assert calls == {"rows_session": session, "genres_session": session}
