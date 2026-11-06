from __future__ import annotations

import pytest

from crate import matcher


def _tracks(count: int) -> list[dict]:
    return [
        {"title": f"Recording {index:02d}", "length_sec": 150 + index}
        for index in range(count)
    ]


def _local(tracks: list[dict]) -> dict:
    return {
        "artist": "Comeback Kid",
        "album": "Chosen Hell",
        "track_count": len(tracks),
        "tracks": tracks,
    }


def _release(tracks: list[dict], primary_type: str = "Album") -> dict:
    return {
        "mbid": "album-release",
        "title": "Chosen Hell",
        "artist": "Comeback Kid",
        "track_count": len(tracks),
        "release_group_primary_type": primary_type,
        "tracks": tracks,
    }


def test_single_cannot_score_as_a_full_album_from_one_matching_recording():
    tracks = _tracks(12)

    assert matcher._score_match(_local(tracks), _release(tracks[:1], "Single")) < 70


@pytest.mark.parametrize(
    ("local_count", "release_count", "primary_type"),
    [(1, 11, "Album"), (24, 14, "Album"), (8, 8, "EP")],
)
def test_matching_preserves_partial_albums_deluxe_editions_and_real_eps(
    local_count, release_count, primary_type
):
    tracks = _tracks(max(local_count, release_count))

    assert (
        matcher._score_match(
            _local(tracks[:local_count]),
            _release(tracks[:release_count], primary_type),
        )
        >= 70
    )


def test_search_prioritizes_track_count_match_before_same_title_singles(monkeypatch):
    def search(**kwargs):
        if "tracks" in kwargs:
            return {"release-list": [{"id": "full-album", "title": "Chosen Hell"}]}
        return {
            "release-list": [
                {"id": f"single-{index}", "title": "Chosen Hell"} for index in range(6)
            ]
        }

    monkeypatch.setattr(matcher.musicbrainzngs, "search_releases", search)

    candidates = matcher._search_musicbrainz("Comeback Kid", "Chosen Hell", 11)

    assert candidates[0]["mbid"] == "full-album"


def test_search_prefers_album_with_one_extra_local_duplicate(monkeypatch):
    def search(**kwargs):
        if "tracks" in kwargs:
            return {"release-list": []}
        return {
            "release-list": [
                {
                    "id": "single",
                    "title": "Chosen Hell",
                    "medium-list": [{"track-count": "1"}],
                },
                {
                    "id": "full-album",
                    "title": "Chosen Hell",
                    "medium-list": [{"track-count": "11"}],
                },
            ]
        }

    monkeypatch.setattr(matcher.musicbrainzngs, "search_releases", search)

    candidates = matcher._search_musicbrainz("Comeback Kid", "Chosen Hell", 12)

    assert candidates[0]["mbid"] == "full-album"


def test_rematch_rejects_new_incompatible_single_even_with_a_high_score(monkeypatch):
    from crate.worker_handlers import enrichment

    tracks = _tracks(12)
    monkeypatch.setattr(enrichment, "wait_for_provider_slot", lambda *_args: None)
    monkeypatch.setattr(
        matcher, "_search_musicbrainz", lambda *_args: [{"mbid": "single"}]
    )
    monkeypatch.setattr(
        matcher, "_get_release_detail", lambda _mbid: _release(tracks[:1], "Single")
    )
    monkeypatch.setattr(matcher, "_score_match", lambda *_args: 100)

    release, score = enrichment._find_best_album_release(
        "Comeback Kid", "Chosen Hell", 12, _local(tracks), max_candidates=5
    )

    assert release is None
    assert score == 0


def test_confirmed_album_identity_invalidates_a_similar_length_ep():
    from crate.worker_handlers.enrichment import _existing_release_is_incompatible

    assert _existing_release_is_incompatible(
        {"track_count": 11, "expected_release_group_id": "full-album"},
        {
            "track_count": 8,
            "release_group_primary_type": "EP",
            "release_group_id": "old-ep",
        },
    )


def test_known_album_group_bypasses_homonymous_single_search_results(monkeypatch):
    from crate.worker_handlers import enrichment

    tracks = _tracks(11)
    local = {**_local(tracks), "expected_release_group_id": "full-group"}
    calls = []
    monkeypatch.setattr(enrichment, "wait_for_provider_slot", lambda *_args: None)
    monkeypatch.setattr(
        matcher,
        "_search_musicbrainz",
        lambda *_args: pytest.fail("known album identity must not use title search"),
    )
    monkeypatch.setattr(
        matcher.musicbrainzngs,
        "browse_releases",
        lambda **kwargs: (
            calls.append(kwargs) or {"release-list": [{"id": "full-release"}]}
        ),
    )
    monkeypatch.setattr(
        matcher,
        "_get_release_detail",
        lambda _mbid: {
            **_release(tracks),
            "mbid": "full-release",
            "release_group_id": "full-group",
        },
    )

    release, score = enrichment._find_best_album_release(
        "Comeback Kid", "Chosen Hell", 11, local, max_candidates=5
    )

    assert release["mbid"] == "full-release"
    assert score == 100
    assert calls == [{"release_group": "full-group", "limit": 5}]


def test_release_tags_follow_recording_titles_instead_of_file_order(
    monkeypatch, tmp_path
):
    import mutagen
    from crate.worker_handlers.enrichment import _write_album_release_tags

    tags = {}

    class Audio(dict):
        def save(self):
            pass

    tracks = []
    for name, title, duration in (
        ("single", "Chosen Hell", 158.4),
        ("target", "Target On My Back", 168),
        ("album", "Chosen Hell", 158.4),
        ("unmatched", "Another Recording", 240),
    ):
        path = tmp_path / f"{name}.flac"
        path.touch()
        tags[str(path)] = Audio()
        tracks.append({"path": str(path), "title": title, "duration": duration})
    monkeypatch.setattr(mutagen, "File", lambda path, **_kwargs: tags[str(path)])

    _write_album_release_tags(
        tracks,
        {
            "mbid": "full-release",
            "release_group_id": "full-group",
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

    assert (
        tags[str(tmp_path / "single.flac")]["musicbrainz_trackid"] == "chosen-recording"
    )
    assert (
        tags[str(tmp_path / "target.flac")]["musicbrainz_trackid"] == "target-recording"
    )
    assert (
        tags[str(tmp_path / "album.flac")]["musicbrainz_trackid"] == "chosen-recording"
    )
    assert tags[str(tmp_path / "unmatched.flac")] == {}


@pytest.mark.parametrize(
    ("track", "candidates", "expected"),
    [
        (
            {"title": " chosen   HELL ", "duration": 158.4},
            [{"title": "Chosen Hell", "length_sec": 158, "mbid": "chosen"}],
            "chosen",
        ),
        (
            {"title": "Chosen Hell", "duration": 158.4},
            [
                {"title": "Chosen Hell", "length_sec": 158, "mbid": "studio"},
                {"title": "Chosen Hell", "length_sec": 220, "mbid": "live"},
            ],
            "studio",
        ),
        (
            {"title": "Chosen Hell"},
            [
                {"title": "Chosen Hell", "mbid": "studio"},
                {"title": "Chosen Hell", "mbid": "live"},
            ],
            None,
        ),
        (
            {"title": "Chosen Hell", "duration": 220},
            [{"title": "Chosen Hell", "length_sec": 158, "mbid": "studio"}],
            None,
        ),
        ({"duration": 158}, [{"title": "Chosen Hell", "mbid": "studio"}], None),
    ],
)
def test_recording_mapping_is_conservative(track, candidates, expected):
    from crate.release_track_matching import match_release_track

    matched = match_release_track(track, candidates)

    assert (matched.get("mbid") if matched is not None else None) == expected
