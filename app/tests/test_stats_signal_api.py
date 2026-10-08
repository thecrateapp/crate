"""The dashboard API passes the signal sections through and validates windows."""

from unittest.mock import patch


def _signal_dashboard() -> dict:
    from crate.db.user_stats_dashboard_surface import _cold_dashboard

    payload = _cold_dashboard("year:2026", None, "user:1:year:2026")
    payload.update(
        {
            "timezone": "Europe/Madrid",
            "provisional": True,
            "tape": {
                "granularity": "day",
                "start": "2026-01-01",
                "end": "2027-01-01",
                "points": [{"bucket": "2026-01-01", "minutes": 42.5, "plays": 11}],
                "mood": [{"bucket": "2026-01-01", "energy": 0.8, "valence": None}],
                "peaks": [
                    {
                        "kind": "obsession",
                        "bucket": "2026-03-14",
                        "day": "2026-03-14",
                        "value": 31,
                        "track": {"title": "Spectral Wound", "artist": "Black Curse"},
                    }
                ],
                "months": [
                    {
                        "month": "2026-01",
                        "minutes": 900.0,
                        "plays": 210,
                        "top_artist": "Converge",
                    }
                ],
            },
            "highlights": {
                "longest_streak": {
                    "days": 47,
                    "start": "2026-08-02",
                    "end": "2026-09-17",
                },
                "current_streak": {"days": 12},
                "new_artists": {"count": 61, "share": 0.21},
                "longest_session": {"minutes": 400.0, "track_count": 92},
                "obsession": None,
            },
            "heatmap": {
                "cells": [[0.0] * 24 for _ in range(7)],
                "peak": None,
                "night_share": 0.38,
            },
            "music_age": {
                "median_year": 2009,
                "decades": [
                    {
                        "decade": 2000,
                        "share": 1.0,
                        "top_album": {
                            "album": "Jane Doe",
                            "artist": "Converge",
                            "album_id": 18,
                            "album_slug": "converge-jane-doe",
                            "year": 2001,
                        },
                    }
                ],
            },
            "genre_trend": [
                {"genre_name": "metalcore", "share": 0.34, "delta_vs_previous": 0.02}
            ],
        }
    )
    return payload


def test_dashboard_returns_the_signal_sections(test_app):
    with patch(
        "crate.api.me.get_user_stats_dashboard", return_value=_signal_dashboard()
    ) as mock_dashboard:
        resp = test_app.get("/api/me/stats/dashboard?window=year:2026")

    assert resp.status_code == 200
    assert mock_dashboard.call_args.kwargs["window"] == "year:2026"
    data = resp.json()
    assert data["timezone"] == "Europe/Madrid"
    assert data["tape"]["points"][0]["plays"] == 11
    assert data["tape"]["peaks"][0]["track"]["title"] == "Spectral Wound"
    assert data["highlights"]["longest_streak"]["days"] == 47
    assert data["music_age"]["median_year"] == 2009
    assert data["music_age"]["decades"][0]["top_album"]["album"] == "Jane Doe"
    assert data["genre_trend"][0]["delta_vs_previous"] == 0.02


def test_dashboard_rejects_unknown_windows(test_app):
    resp = test_app.get("/api/me/stats/dashboard?window=year:1800")
    assert resp.status_code == 400
