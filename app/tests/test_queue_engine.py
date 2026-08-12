from crate.queue_engine import (
    QueueIntent,
    QueueState,
    blend_target_towards,
    candidate_matches_intent,
    candidate_family_key,
    candidate_id,
    candidate_artist_key,
    candidate_song_key,
    collective_vote_target,
    needs_refill,
    select_diverse_candidates,
)


def _track(
    track_id: int,
    *,
    title: str,
    artist: str,
    bliss: list[float] | None = None,
) -> dict:
    return {
        "track_id": track_id,
        "track_entity_uid": f"track-{track_id}",
        "track_path": f"/music/{track_id}.flac",
        "title": title,
        "artist": artist,
        "bliss_vector": bliss or [1.0, 0.0],
    }


def test_candidate_identity_accepts_flat_sql_and_nested_listen_payloads() -> None:
    flat = _track(1, title="Concubine", artist="Converge")
    nested = {"track": {"id": 1, "title": "Concubine", "artist": "Converge"}}

    assert candidate_id(flat) == "1"
    assert candidate_id(nested) == "1"
    assert candidate_artist_key(flat) == "converge"
    assert candidate_song_key(nested) == ("converge", "concubine")
    assert candidate_family_key(
        {**flat, "title": "Concubine (Live at CBGB)"}
    ) == candidate_family_key(flat)


def test_candidate_song_key_collapses_album_version_suffixes() -> None:
    assert candidate_song_key(
        {"title": "Concubine (Album Version)", "artist": "Converge"}
    ) == candidate_song_key({"title": "Concubine", "artist": "Converge"})


def test_select_diverse_candidates_rejects_variants_and_repeated_artists() -> None:
    candidates = [
        _track(1, title="A", artist="Artist One"),
        _track(2, title="A (Remix)", artist="Artist One"),
        _track(3, title="B", artist="Artist One"),
        _track(4, title="C", artist="Artist Two"),
    ]

    selected = select_diverse_candidates(
        candidates,
        limit=4,
        max_per_artist=1,
        existing_candidates=[],
    )

    assert [candidate_id(row) for row in selected] == ["1", "4"]


def test_collective_votes_weight_the_bliss_centroid() -> None:
    target, vote_count = collective_vote_target(
        [
            {"bliss_vector": [1.0, 0.0], "vote_count": 2},
            {"bliss_vector": [0.0, 1.0], "vote_count": 1},
        ]
    )

    assert target == [2 / 3, 1 / 3]
    assert vote_count == 3


def test_feedback_target_blend_matches_radio_cap() -> None:
    blended = blend_target_towards(
        [1.0, 0.0],
        [0.0, 1.0],
        feedback_count=3,
    )

    assert blended == [0.76, 0.24]


def test_queue_refill_is_not_requested_for_a_paused_or_full_queue() -> None:
    assert not needs_refill(
        QueueState(
            queued_count=4,
            remaining_count=4,
            target_size=4,
            low_water_mark=4,
        )
    )
    assert not needs_refill(
        QueueState(
            queued_count=1,
            remaining_count=1,
            target_size=4,
            low_water_mark=4,
            paused=True,
        )
    )


def test_queue_intent_keeps_auto_dj_generation_inputs_typed() -> None:
    intent = QueueIntent(
        profile="jam_auto_dj",
        listener_id=7,
        seed_type="room",
        seed_value="room-1",
        genres=("hardcore",),
        target_size=4,
    )

    assert intent.profile == "jam_auto_dj"
    assert intent.genres == ("hardcore",)


def test_candidate_matches_intent_applies_bpm_and_mood_bounds() -> None:
    intent = QueueIntent(
        profile="jam_auto_dj",
        bpm_min=110,
        bpm_max=130,
        mood="energetic",
    )

    assert candidate_matches_intent(
        {"bpm": 120, "energy": 0.8, "danceability": 0.6}, intent
    )
    assert not candidate_matches_intent(
        {"bpm": 100, "energy": 0.8, "danceability": 0.6}, intent
    )
    assert not candidate_matches_intent(
        {"bpm": 120, "energy": 0.5, "danceability": 0.6}, intent
    )


def test_generation_seed_is_stable_for_a_listener_context_and_day() -> None:
    from crate.queue_engine import generation_seed

    first = generation_seed(
        listener_id=7,
        context="jam:room-1",
        session_id="room-1",
        reference_day="2026-08-04",
    )
    second = generation_seed(
        listener_id=7,
        context="jam:room-1",
        session_id="room-1",
        reference_day="2026-08-04",
    )

    assert first == second
    assert first != generation_seed(
        listener_id=8,
        context="jam:room-1",
        session_id="room-1",
        reference_day="2026-08-04",
    )
