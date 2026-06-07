from __future__ import annotations

from crate.playlist_refinement import (
    apply_playlist_refinement_actions,
    build_playlist_refinement_proposal,
)


def _track(
    position: int,
    *,
    title: str,
    artist: str,
    album: str = "Album",
    genre: str = "screamo",
    source: str = "generated",
    locked: bool = False,
) -> dict:
    return {
        "id": position,
        "track_id": position,
        "position": position,
        "title": title,
        "artist": artist,
        "album": album,
        "genre": genre,
        "source": source,
        "locked": locked,
    }


def test_build_playlist_refinement_proposal_flags_safe_playlist_fixes():
    proposal = build_playlist_refinement_proposal(
        playlist={"name": "Screamo Core"},
        smart_rules={
            "match": "all",
            "limit": 5,
            "max_per_artist": 2,
            "rules": [{"field": "genre", "op": "contains", "value": "screamo"}],
        },
        tracks=[
            _track(1, title="Comfort", artist="Artist A", source="manual", locked=True),
            _track(2, title="Comfort (Live)", artist="Artist A", album="Live Set"),
            _track(3, title="Another", artist="Artist A"),
            _track(4, title="Outside", artist="Artist B", genre="ambient"),
        ],
    )

    issue_types = {issue["type"] for issue in proposal["issues"]}
    action_positions = {action["position"] for action in proposal["actions"]}

    assert issue_types == {
        "artist_overrepresented",
        "duplicate_song",
        "weak_genre_match",
    }
    assert action_positions == {2, 3, 4}
    assert proposal["score_version"] == "playlist_refinement_v1"


def test_apply_playlist_refinement_actions_removes_selected_positions(monkeypatch):
    calls: list[tuple[int, int, bool, int | None]] = []

    def fake_remove_playlist_track(
        playlist_id: int,
        position: int,
        *,
        record_exclusion: bool = False,
        excluded_by_user_id: int | None = None,
    ) -> None:
        calls.append((playlist_id, position, record_exclusion, excluded_by_user_id))

    monkeypatch.setattr(
        "crate.db.repositories.playlists_tracks.remove_playlist_track",
        fake_remove_playlist_track,
    )

    applied_count = apply_playlist_refinement_actions(
        playlist_id=77,
        user_id=9,
        selected_action_ids={"remove:4", "skip"},
        actions=[
            {"id": "remove:2", "type": "remove_track", "position": 2},
            {"id": "remove:4", "type": "remove_track", "position": 4},
        ],
    )

    assert applied_count == 1
    assert calls == [(77, 4, True, 9)]
