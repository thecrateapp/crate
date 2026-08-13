"""Behavioural contracts for the detached Jam Room Auto DJ."""

import crate.jam_auto_dj as auto_dj
from crate.queue_engine import QueueIntent
from crate.jam_auto_dj import (
    _collective_vote_target,
    choose_auto_dj_candidate,
    rank_auto_dj_candidates,
)


def _candidate(
    track_id: str,
    *,
    artist: str,
    bpm: float,
    genres: list[str],
    bliss: list[float],
    popularity: float = 0,
    room_plays: int = 0,
) -> dict:
    return {
        "track": {"id": track_id, "title": track_id, "artist": artist},
        "artist": artist,
        "bpm": bpm,
        "genres": genres,
        "bliss_vector": bliss,
        "popularity": popularity,
        "room_plays": room_plays,
    }


def test_auto_dj_prefers_a_similar_track_in_allowed_genres() -> None:
    current = {"bpm": 120, "bliss_vector": [1.0, 0.0, 0.0]}
    candidates = [
        _candidate(
            "wrong-genre",
            artist="Other",
            bpm=120,
            genres=["ambient"],
            bliss=[1.0, 0.0, 0.0],
        ),
        _candidate(
            "match",
            artist="Target",
            bpm=118,
            genres=["post-hardcore"],
            bliss=[0.98, 0.02, 0.0],
        ),
    ]

    selected = choose_auto_dj_candidate(
        candidates,
        current_track=current,
        genre_filters=["post-hardcore"],
        recent_artists=[],
        random_value=0.0,
    )

    assert selected is not None
    assert selected["track"]["id"] == "match"


def test_auto_dj_intent_provides_normalized_genre_filters() -> None:
    selected = choose_auto_dj_candidate(
        [
            _candidate(
                "ambient-track",
                artist="Ambient Artist",
                bpm=120,
                genres=["ambient"],
                bliss=[1.0, 0.0, 0.0],
            ),
            _candidate(
                "hardcore-track",
                artist="Hardcore Artist",
                bpm=120,
                genres=["hardcore"],
                bliss=[1.0, 0.0, 0.0],
            ),
        ],
        current_track=None,
        intent=QueueIntent(profile="jam_auto_dj", genres=("hardcore",)),
        random_value=0.0,
    )

    assert selected is not None
    assert selected["track"]["id"] == "hardcore-track"


def test_auto_dj_applies_bpm_bounds_from_intent() -> None:
    selected = choose_auto_dj_candidate(
        [
            _candidate(
                "too-slow",
                artist="Slow Artist",
                bpm=90,
                genres=["hardcore"],
                bliss=[1.0, 0.0, 0.0],
            ),
            _candidate(
                "in-range",
                artist="Target Artist",
                bpm=120,
                genres=["hardcore"],
                bliss=[1.0, 0.0, 0.0],
            ),
        ],
        current_track=None,
        intent=QueueIntent(
            profile="jam_auto_dj",
            genres=("hardcore",),
            bpm_min=110,
            bpm_max=130,
        ),
        random_value=0.0,
    )

    assert selected is not None
    assert selected["track"]["id"] == "in-range"


def test_auto_dj_accepts_the_flat_candidate_shape_returned_by_sql() -> None:
    selected = choose_auto_dj_candidate(
        [
            {
                "track_id": 42,
                "track_entity_uid": "track-42",
                "track_path": "/music/track-42.flac",
                "title": "Track 42",
                "artist": "Target",
                "bpm": 120,
                "genres": ["hardcore"],
                "bliss_vector": [1.0, 0.0, 0.0],
            }
        ],
        current_track=None,
        genre_filters=["hardcore"],
        random_value=0.0,
    )

    assert selected is not None
    assert selected["track_id"] == 42


def test_auto_dj_avoids_recent_artist_when_another_candidate_is_available() -> None:
    candidates = [
        _candidate(
            "repeat",
            artist="Played Artist",
            bpm=120,
            genres=["hardcore"],
            bliss=[1.0, 0.0, 0.0],
            popularity=100,
        ),
        _candidate(
            "fresh",
            artist="Fresh Artist",
            bpm=119,
            genres=["hardcore"],
            bliss=[0.98, 0.02, 0.0],
        ),
    ]

    selected = choose_auto_dj_candidate(
        candidates,
        current_track={"bpm": 120, "bliss_vector": [1.0, 0.0, 0.0]},
        genre_filters=["hardcore"],
        recent_artists=["played artist"],
        random_value=0.0,
    )

    assert selected is not None
    assert selected["track"]["id"] == "fresh"


def test_auto_dj_target_can_be_shaped_by_collective_votes() -> None:
    candidates = [
        _candidate(
            "continuity",
            artist="Continuity Artist",
            bpm=120,
            genres=["hardcore"],
            bliss=[0.0, 1.0, 0.0],
        ),
        _candidate(
            "voted",
            artist="Voted Artist",
            bpm=120,
            genres=["hardcore"],
            bliss=[1.0, 0.0, 0.0],
        ),
    ]

    selected = choose_auto_dj_candidate(
        candidates,
        current_track={"bpm": 120, "bliss_vector": [0.0, 1.0, 0.0]},
        target_vector=[1.0, 0.0, 0.0],
        genre_filters=["hardcore"],
        random_value=0.0,
    )

    assert selected is not None
    assert selected["track"]["id"] == "voted"


def test_auto_dj_identity_helpers_use_shared_queue_engine(monkeypatch) -> None:
    monkeypatch.setattr(
        auto_dj, "shared_candidate_artist_key", lambda _row: "shared-artist"
    )
    monkeypatch.setattr(
        auto_dj, "shared_candidate_family_key", lambda _row: "shared-family"
    )
    monkeypatch.setattr(auto_dj, "shared_candidate_id", lambda _row: "shared-id")

    assert auto_dj._candidate_artist({}) == "shared-artist"
    assert auto_dj._candidate_family_key({}) == "shared-family"
    assert auto_dj._candidate_id({}) == "shared-id"


def test_auto_dj_collective_vote_target_blends_with_current_track() -> None:
    target = _collective_vote_target(
        {"blissVector": [1.0, 0.0]},
        [{"bliss_vector": [0.0, 1.0], "vote_count": 2}],
    )

    assert target == [0.84, 0.16]


def test_auto_dj_does_not_resume_after_an_explicit_pause_without_current_track(
    monkeypatch,
) -> None:
    room = {
        "id": "room-1",
        "host_user_id": 1,
        "genre_filters": [],
        "current_track_payload": {"track": None, "playing": False},
    }

    monkeypatch.setattr(auto_dj, "_room_lock", lambda room_id: (None, None))
    monkeypatch.setattr("crate.db.jam.get_jam_room", lambda room_id: room)
    monkeypatch.setattr(
        auto_dj,
        "_fill_auto_dj_queue",
        lambda current_room, redis: [{"id": "queued"}],
    )

    assert auto_dj.ensure_auto_dj_room(room) is False


def test_auto_dj_fills_a_long_initial_buffer_without_duplicate_tracks(
    monkeypatch,
) -> None:
    room = {
        "id": "room-1",
        "host_user_id": 1,
        "genre_filters": ["hardcore"],
    }
    candidates = [
        {
            "track_id": index,
            "track_entity_uid": f"track-{index}",
            "title": f"Track {index}",
            "artist": f"Artist {index}",
            "album": "Album",
            "duration": 180,
            "bpm": 120,
            "genres": ["hardcore"],
            "bliss_vector": [1.0, 0.0, 0.0],
        }
        for index in range(1, auto_dj._AUTO_DJ_BUFFER_SIZE + 1)
    ]
    queue: list[dict] = []

    monkeypatch.setattr(
        "crate.db.jam.list_jam_queue_items", lambda room_id: list(queue)
    )
    monkeypatch.setattr("crate.db.jam.list_jam_queue_vote_tracks", lambda room_id: [])
    monkeypatch.setattr("crate.db.jam.list_recent_auto_dj_artists", lambda room_id: [])
    monkeypatch.setattr("crate.db.jam.list_recent_auto_dj_tracks", lambda room_id: [])
    monkeypatch.setattr(
        "crate.db.jam.list_auto_dj_candidates",
        lambda room_id, **kwargs: candidates,
    )

    def append_track(room, candidate, redis) -> None:
        track = auto_dj.candidate_to_track_payload(candidate)
        queue.append(
            {"id": str(candidate["track_id"]), "status": "queued", "track": track}
        )

    monkeypatch.setattr(auto_dj, "_append_auto_dj_track", append_track)

    filled = auto_dj._fill_auto_dj_queue(room, None)

    assert len(filled) == auto_dj._AUTO_DJ_BUFFER_SIZE
    assert len({item["track"]["id"] for item in filled}) == auto_dj._AUTO_DJ_BUFFER_SIZE


def test_auto_dj_preview_is_ranked_using_the_same_selection_signals() -> None:
    candidates = [
        _candidate(
            "similar",
            artist="Fresh Artist",
            bpm=121,
            genres=["hardcore"],
            bliss=[0.99, 0.01, 0.0],
        ),
        _candidate(
            "different",
            artist="Other Artist",
            bpm=180,
            genres=["hardcore"],
            bliss=[0.0, 0.0, 1.0],
        ),
    ]

    ranked = rank_auto_dj_candidates(
        candidates,
        current_track={"bpm": 120, "bliss_vector": [1.0, 0.0, 0.0]},
        genre_filters=["hardcore"],
        random_value=0.0,
    )

    assert [candidate["track"]["id"] for candidate in ranked] == [
        "similar",
        "different",
    ]
