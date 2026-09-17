from crate.subsonic.capabilities import advertised_extensions
from crate.subsonic.interoperability import (
    EXTENSION_PROBES,
    REQUIRED_PROTOCOL_SCENARIOS,
    SmokeClient,
    SmokeFixture,
    SmokeResponse,
)


def test_smoke_harness_covers_every_advertised_extension() -> None:
    advertised = {extension["name"] for extension in advertised_extensions()}

    assert set(EXTENSION_PROBES) == advertised


def test_smoke_harness_covers_required_protocol_scenarios() -> None:
    assert set(REQUIRED_PROTOCOL_SCENARIOS) == {
        "unauthenticated_extension_discovery",
        "api_key_authentication",
        "password_authentication",
        "token_salt_authentication",
        "artist_album_track_browse",
        "artwork_resolution",
        "search_and_genres",
        "playlist_crud",
        "star_rating_and_scrobble",
        "queue_save_restore",
        "stream_seek_and_download",
        "advertised_extensions",
    }


def test_json_probe_preserves_anonymous_auth_and_case_insensitive_headers(
    monkeypatch,
) -> None:
    client = SmokeClient(
        "http://opensubsonic.test/rest",
        SmokeFixture("listener", "secret", "ga-artist", "gal-album", "gt-track"),
    )
    captured: dict = {}

    def fake_request(endpoint, params, **_kwargs):
        captured["endpoint"] = endpoint
        captured["params"] = params
        return SmokeResponse(
            200,
            {"content-type": "application/json"},
            b'{"subsonic-response":{"status":"ok"}}',
        )

    monkeypatch.setattr(client, "_request", fake_request)

    result = client.json("getOpenSubsonicExtensions", auth={})

    assert result["status"] == "ok"
    assert captured["endpoint"] == "getOpenSubsonicExtensions"
    assert "u" not in captured["params"]
    assert "p" not in captured["params"]
