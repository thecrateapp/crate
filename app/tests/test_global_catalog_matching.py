from crate.federation.global_matching import (
    album_match_key,
    artist_match_key,
    normalize_name,
    score_album_match,
    score_artist_match,
    score_track_match,
    track_match_key,
)


def test_normalize_name_is_case_punctuation_whitespace_and_feat_safe():
    assert normalize_name("  Café   Tacvba!!! ") == "cafe tacvba"
    assert normalize_name("Artist feat. Guest") == "artist"
    assert normalize_name("Artist (feat. Guest)") == "artist"
    assert normalize_name("Björk & The Sugarcubes") == "bjork and the sugarcubes"
    assert normalize_name("DRIFT Episode 2 “ATOM”") == "drift episode 2 atom"


def test_normalize_name_only_strips_explicit_edition_suffixes():
    assert (
        normalize_name(
            "Live from Teatro Dal Verme, Milan, Italy. March 24th, 2005",
            strip_edition=True,
        )
        == "live from teatro dal verme milan italy march 24th 2005"
    )
    assert normalize_name("Songs of Faith and Devotion Live", strip_edition=True) == (
        "songs of faith and devotion live"
    )
    assert normalize_name("Toward the Within (Live)", strip_edition=True) == (
        "toward the within live"
    )
    assert normalize_name("Pedals (Deluxe Edition)", strip_edition=True) == "pedals"


def test_match_keys_are_deterministic_and_conservative():
    assert artist_match_key({"name": "Rival Schools"}) == "artist:rival schools"
    assert (
        album_match_key(
            {
                "artist": "Rival Schools",
                "title": "Pedals (Deluxe Edition)",
                "year": "2011",
            }
        )
        == "album:rival schools|pedals|2011"
    )
    assert (
        track_match_key(
            {
                "artist": "Rival Schools",
                "album": "Pedals",
                "title": "Wring It Out",
                "disc_number": 1,
                "track_number": 1,
            }
        )
        == "track:rival schools|pedals|1|1|wring it out"
    )


def test_artist_scoring_uses_authoritative_ids_before_name_matches():
    exact = score_artist_match(
        {"name": "Rival Schools", "musicbrainz_artist_mbid": "artist-mbid"},
        {"name": "Rival Schools", "musicbrainz_artist_mbid": "artist-mbid"},
    )
    assert exact.confidence == 1.0
    assert exact.auto_merge is True
    assert exact.method == "musicbrainz_artist_mbid"

    name_only = score_artist_match(
        {"name": "Rival Schools"},
        {"name": "rival schools"},
    )
    assert name_only.confidence == 0.94
    assert name_only.auto_merge is True

    conflicting = score_artist_match(
        {"name": "Rival Schools", "musicbrainz_artist_mbid": "left"},
        {"name": "Rival Schools", "musicbrainz_artist_mbid": "right"},
    )
    assert conflicting.auto_merge is False
    assert conflicting.confidence < 0.85


def test_album_scoring_keeps_ambiguous_editions_out_of_auto_merge():
    release = score_album_match(
        {
            "artist": "Rival Schools",
            "title": "Pedals",
            "musicbrainz_release_mbid": "rel",
        },
        {
            "artist": "Rival Schools",
            "title": "Pedals",
            "musicbrainz_release_mbid": "rel",
        },
    )
    assert release.confidence == 1.0
    assert release.auto_merge is True

    strong = score_album_match(
        {
            "artist": "Rival Schools",
            "title": "Pedals",
            "year": "2011",
            "track_count": 10,
        },
        {
            "artist": "rival schools",
            "title": "Pedals",
            "year": "2012",
            "track_count": 10,
        },
    )
    assert strong.confidence == 0.93
    assert strong.auto_merge is True

    ambiguous = score_album_match(
        {"artist": "Rival Schools", "title": "Pedals"},
        {"artist": "Rival Schools", "title": "Pedals (Deluxe Edition)"},
    )
    assert ambiguous.candidate is True
    assert ambiguous.auto_merge is False


def test_track_scoring_uses_recording_id_and_album_position_duration():
    recording = score_track_match(
        {"title": "Wring It Out", "musicbrainz_recording_mbid": "rec"},
        {"title": "Wring It Out", "musicbrainz_recording_mbid": "rec"},
    )
    assert recording.confidence == 1.0
    assert recording.auto_merge is True

    same_album = score_track_match(
        {
            "album": "Pedals",
            "title": "Wring It Out",
            "disc_number": 1,
            "track_number": 1,
            "duration_seconds": 214,
        },
        {
            "album": "Pedals",
            "title": "Wring It Out",
            "disc_number": 1,
            "track_number": 1,
            "duration_seconds": 216,
        },
    )
    assert same_album.confidence == 0.93
    assert same_album.auto_merge is True

    different_album = score_track_match(
        {"album": "Pedals", "title": "Wring It Out", "duration_seconds": 214},
        {"album": "Found", "title": "Wring It Out", "duration_seconds": 214},
    )
    assert different_album.candidate is True
    assert different_album.auto_merge is False
