"""crate.federation.results/1: the owner's envelope and A's adapter (FED1.1, FED-D5)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from crate.federation.results_envelope import (
    RESULTS_CONTRACT,
    SEARCH_LEASE_TTL,
    build_results_envelope,
    envelope_to_search_contract,
    parse_results_envelope,
)

NOW = datetime(2026, 11, 12, 18, 0, tzinfo=UTC)
OWNER_UID = "00000000-0000-0000-0000-00000000000b"
PEER = {
    "node_uid": OWNER_UID,
    "display_name": "Les Pedants",
    "default_grant_preset": "listen",
}

OWNER_SEARCH = {
    "artists": [
        {
            "id": 7,
            "entity_uid": "artist-uid",
            "slug": "joy-division",
            "name": "Joy Division",
            "has_photo": True,
            "score": 1.2,
        }
    ],
    "albums": [
        {
            "id": 70,
            "entity_uid": "album-uid",
            "slug": "unknown-pleasures",
            "artist": "Joy Division",
            "name": "Unknown Pleasures",
            "year": "1979",
            "has_cover": True,
            "artist_id": 7,
        }
    ],
    "tracks": [
        {
            "id": 700,
            "entity_uid": "track-uid",
            "title": "Disorder",
            "artist": "Joy Division",
            "album": "Unknown Pleasures",
            "album_id": 70,
            "path": "/music/Joy Division/1979 - Unknown Pleasures/01 Disorder.flac",
            "duration": 209.5,
            "year": "1979",
            "format": "FLAC",
            "bitrate": 1011,
        }
    ],
}


def _owner_envelope(**overrides) -> dict:
    return build_results_envelope(
        OWNER_SEARCH,
        node_uid=OWNER_UID,
        node_name="Les Pedants",
        lease_scope="catalog.search",
        truncated=False,
        now=NOW,
        **overrides,
    )


class TestOwnerEnvelope:
    def test_declares_the_contract_and_its_source(self):
        envelope = _owner_envelope()

        assert envelope["contract"] == RESULTS_CONTRACT == "crate.federation.results/1"
        assert envelope["source"] == {
            "node_uid": OWNER_UID,
            "node_name": "Les Pedants",
            "fetched_at": NOW.isoformat(),
        }
        assert envelope["coverage"] == {"complete": True, "truncated": False}

    def test_items_carry_identity_fields_availability_and_lease(self):
        items = {item["entity_type"]: item for item in _owner_envelope()["items"]}
        lease = {
            "scope": "catalog.search",
            "expires_at": (NOW + SEARCH_LEASE_TTL).isoformat(),
        }

        assert items["artist"] == {
            "entity_type": "artist",
            "remote_entity_uid": "artist-uid",
            "fields": {"name": "Joy Division"},
            "lease": lease,
        }
        assert items["album"] == {
            "entity_type": "album",
            "remote_entity_uid": "album-uid",
            "fields": {
                "name": "Unknown Pleasures",
                "artist": "Joy Division",
                "year": 1979,
            },
            "lease": lease,
        }
        assert items["track"] == {
            "entity_type": "track",
            "remote_entity_uid": "track-uid",
            "fields": {
                "name": "Disorder",
                "artist": "Joy Division",
                "album": "Unknown Pleasures",
                "year": 1979,
                "duration_ms": 209500,
            },
            "availability": {"playable": True, "formats": ["flac"], "bitrate": 1011},
            "lease": lease,
        }

    def test_the_lease_lasts_24_hours(self):
        assert SEARCH_LEASE_TTL == timedelta(hours=24)

    def test_never_carries_local_ids_paths_or_slugs(self):
        serialized = repr(_owner_envelope())

        for leaked in ("/music/", "joy-division", "'id'", "album_id", "has_photo"):
            assert leaked not in serialized

    def test_rows_without_an_entity_uid_are_left_out(self):
        envelope = build_results_envelope(
            {"artists": [{"name": "No identity"}], "albums": [], "tracks": []},
            node_uid=OWNER_UID,
            node_name="Les Pedants",
            lease_scope="catalog.search",
            truncated=True,
            now=NOW,
        )

        assert envelope["items"] == []
        assert envelope["coverage"] == {"complete": True, "truncated": True}

    def test_an_incomplete_search_says_so(self):
        envelope = _owner_envelope(complete=False)

        assert envelope["coverage"]["complete"] is False


class TestAdapterIntoListenContract:
    def test_round_trip_maps_items_to_remote_search_results(self):
        envelope = parse_results_envelope(_owner_envelope())
        assert envelope is not None

        results = envelope_to_search_contract(envelope, peer=PEER, now=NOW)

        source = {
            "origin": "remote",
            "node_uid": OWNER_UID,
            "node_name": "Les Pedants",
        }
        assert results["artists"] == [
            {**source, "remote_entity_uid": "artist-uid", "name": "Joy Division"}
        ]
        assert results["albums"] == [
            {
                **source,
                "remote_entity_uid": "album-uid",
                "name": "Unknown Pleasures",
                "artist": "Joy Division",
                "year": "1979",
            }
        ]
        [track] = results["tracks"]
        assert track == {
            **source,
            "remote_entity_uid": "track-uid",
            "title": "Disorder",
            "artist": "Joy Division",
            "album": "Unknown Pleasures",
            "year": "1979",
            "duration": 209.5,
            "format": "flac",
            "bitrate": 1011,
            "availability": {"catalog": True, "stream": True, "import": False},
            "lease_expires_at": (NOW + SEARCH_LEASE_TTL).isoformat(),
        }

    def test_results_never_reuse_the_owners_local_identity(self):
        envelope = parse_results_envelope(_owner_envelope())
        assert envelope is not None
        results = envelope_to_search_contract(envelope, peer=PEER, now=NOW)

        for group in results.values():
            for item in group:
                assert "id" not in item
                assert "entity_uid" not in item
                assert "slug" not in item

    def test_unknown_fields_are_ignored(self):
        raw = _owner_envelope()
        raw["future_top_level"] = {"x": 1}
        raw["source"]["region"] = "eu"
        raw["coverage"]["peers_behind_me"] = 3
        raw["items"][2]["fields"]["loudness_lufs"] = -9.5
        raw["items"][2]["availability"]["channels"] = 2
        raw["items"][2]["lease"]["renew_after"] = NOW.isoformat()
        raw["items"][2]["provenance"] = {"via": "x"}

        envelope = parse_results_envelope(raw)

        assert envelope is not None
        results = envelope_to_search_contract(envelope, peer=PEER, now=NOW)
        assert [track["title"] for track in results["tracks"]] == ["Disorder"]
        assert "loudness_lufs" not in results["tracks"][0]

    def test_unknown_entity_types_are_skipped_not_fatal(self):
        raw = _owner_envelope()
        raw["items"].append(
            {
                "entity_type": "playlist",
                "remote_entity_uid": "p1",
                "fields": {"name": "x"},
            }
        )

        envelope = parse_results_envelope(raw)

        assert envelope is not None
        assert [item.entity_type for item in envelope.items] == [
            "artist",
            "album",
            "track",
        ]

    def test_a_malformed_item_is_skipped_not_fatal(self):
        raw = _owner_envelope()
        raw["items"].insert(0, {"entity_type": "track", "fields": "not-a-dict"})

        envelope = parse_results_envelope(raw)

        assert envelope is not None
        assert len(envelope.items) == 3

    def test_missing_optional_fields_are_fine(self):
        raw = {
            "contract": RESULTS_CONTRACT,
            "source": {"node_uid": OWNER_UID},
            "items": [
                {"entity_type": "track", "remote_entity_uid": "t1"},
                {"entity_type": "album", "remote_entity_uid": "a1", "fields": {}},
            ],
        }

        envelope = parse_results_envelope(raw)

        assert envelope is not None
        assert envelope.coverage.complete is True
        results = envelope_to_search_contract(envelope, peer=PEER, now=NOW)
        [track] = results["tracks"]
        assert track["remote_entity_uid"] == "t1"
        assert track["title"] == ""
        assert track["availability"] == {
            "catalog": True,
            "stream": True,
            "import": False,
        }
        assert results["albums"][0]["name"] == ""

    def test_a_track_the_owner_cannot_play_is_not_streamable(self):
        raw = _owner_envelope()
        raw["items"][2]["availability"]["playable"] = False
        envelope = parse_results_envelope(raw)
        assert envelope is not None

        [track] = envelope_to_search_contract(envelope, peer=PEER, now=NOW)["tracks"]

        assert track["availability"]["stream"] is False

    def test_the_local_grant_still_bounds_streaming(self):
        envelope = parse_results_envelope(_owner_envelope())
        assert envelope is not None
        discovery_peer = {**PEER, "default_grant_preset": "discovery"}

        [track] = envelope_to_search_contract(envelope, peer=discovery_peer, now=NOW)[
            "tracks"
        ]

        assert track["availability"]["stream"] is False

    def test_items_whose_lease_expired_are_hidden(self):
        envelope = parse_results_envelope(_owner_envelope())
        assert envelope is not None

        later = NOW + SEARCH_LEASE_TTL + timedelta(seconds=1)
        results = envelope_to_search_contract(envelope, peer=PEER, now=later)

        assert results == {"artists": [], "albums": [], "tracks": []}

    def test_the_peer_identity_comes_from_pairing_not_the_payload(self):
        raw = _owner_envelope()
        raw["source"]["node_name"] = "Somebody else"
        envelope = parse_results_envelope(raw)
        assert envelope is not None

        results = envelope_to_search_contract(envelope, peer=PEER, now=NOW)

        assert results["artists"][0]["node_name"] == "Les Pedants"

    def test_an_envelope_from_another_node_is_rejected(self):
        raw = _owner_envelope()
        raw["source"]["node_uid"] = "00000000-0000-0000-0000-0000000000ff"
        envelope = parse_results_envelope(raw)
        assert envelope is not None

        with pytest.raises(ValueError, match="source"):
            envelope_to_search_contract(envelope, peer=PEER, now=NOW)

    @pytest.mark.parametrize(
        "raw",
        [
            None,
            [],
            {"artists": [], "albums": [], "tracks": []},
            {
                "contract": "crate.federation.results/2",
                "source": {"node_uid": OWNER_UID},
            },
            {"contract": RESULTS_CONTRACT},
            {
                "contract": RESULTS_CONTRACT,
                "source": {"node_uid": OWNER_UID},
                "items": 3,
            },
        ],
    )
    def test_anything_else_is_not_an_envelope(self, raw):
        assert parse_results_envelope(raw) is None


class TestRequesterNegotiation:
    def _search(self, monkeypatch, answer):
        from crate.federation import search_fanout

        sent: dict = {}

        class Response:
            status_code = 200

            def json(self):
                return answer

        def fake_post(**kwargs):
            sent.update(kwargs)
            return Response()

        monkeypatch.setattr(search_fanout, "federated_post", fake_post)
        result = search_fanout._search_one_peer(
            peer={**PEER, "api_base_url": "https://owner.test"},
            query="joy division",
            limit=10,
            local_node={"node_uid": "a", "active_key_id": "k", "private_key_ref": "r"},
        )
        return sent, result

    def test_asks_for_the_envelope(self, monkeypatch):
        sent, _ = self._search(monkeypatch, {"artists": [], "albums": [], "tracks": []})

        assert sent["json_body"]["contracts"] == [RESULTS_CONTRACT]

    def test_reads_an_envelope_answer(self, monkeypatch):
        answer = build_results_envelope(
            OWNER_SEARCH,
            node_uid=OWNER_UID,
            node_name="Les Pedants",
            lease_scope="catalog.search",
            truncated=False,
        )

        _, result = self._search(monkeypatch, answer)

        assert [track["remote_entity_uid"] for track in result["tracks"]] == [
            "track-uid"
        ]
        assert result["tracks"][0]["origin"] == "remote"

    def test_still_reads_an_old_owner_answer(self, monkeypatch):
        legacy = {
            "artists": [{"name": "Joy Division", "entity_uid": "artist-uid"}],
            "albums": [],
            "tracks": [],
        }

        _, result = self._search(monkeypatch, legacy)

        assert result["artists"][0]["remote_entity_uid"] == "artist-uid"
        assert result["artists"][0]["node_uid"] == OWNER_UID
