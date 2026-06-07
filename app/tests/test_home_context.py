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
