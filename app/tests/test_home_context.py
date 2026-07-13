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


def test_home_context_strips_global_identity_when_home_surface_disabled(monkeypatch):
    monkeypatch.setattr(
        home_context,
        "global_catalog_surface_enabled",
        lambda surface: False,
    )
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

    assert "global_artist_uid" not in context["top_artists"][0]
    assert context["top_artists"][0]["artist_name"] == "High Vis"
