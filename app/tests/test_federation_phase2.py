"""Phase 2 federation tests — search fan-out, merge/dedupe, result tagging."""

from crate.federation.search_fanout import (
    _tag_remote_results,
    _merge_results,
    _artist_match_key,
    _album_match_key,
    _has_strong_local_matches,
)


class TestRemoteResultTagging:
    def test_tags_artists(self):
        data = {
            "artists": [{"name": "Test Artist", "entity_uid": "uuid-1", "id": 1}],
            "albums": [],
            "tracks": [],
        }
        peer = {"node_uid": "node-1", "display_name": "Friend Crate"}
        result = _tag_remote_results(data, peer)
        artist = result["artists"][0]
        assert artist["origin"] == "remote"
        assert artist["node_uid"] == "node-1"
        assert artist["node_name"] == "Friend Crate"
        assert artist["remote_entity_uid"] == "uuid-1"
        assert artist["availability"]["catalog"] is True

    def test_tags_albums(self):
        data = {
            "artists": [],
            "albums": [
                {"name": "Test Album", "artist": "Test Artist", "entity_uid": "uuid-2"}
            ],
            "tracks": [],
        }
        peer = {"node_uid": "node-2", "display_name": "Peer Node"}
        result = _tag_remote_results(data, peer)
        album = result["albums"][0]
        assert album["origin"] == "remote"
        assert album["node_uid"] == "node-2"
        assert album["node_name"] == "Peer Node"

    def test_tags_tracks(self):
        data = {
            "artists": [],
            "albums": [],
            "tracks": [
                {"title": "Test Track", "artist": "Test Artist", "entity_uid": "uuid-3"}
            ],
        }
        peer = {"node_uid": "node-3", "display_name": "Node 3"}
        result = _tag_remote_results(data, peer)
        track = result["tracks"][0]
        assert track["origin"] == "remote"
        assert track["node_uid"] == "node-3"


class TestMergeDedupe:
    def test_merge_adds_remote_when_local_empty(self):
        local = {"artists": [], "albums": [], "tracks": []}
        remote = [
            {
                "artists": [
                    {"name": "Remote Artist", "origin": "remote", "node_uid": "n1"}
                ],
                "albums": [],
                "tracks": [],
            }
        ]
        result = _merge_results(local, remote)
        assert len(result["artists"]) == 1
        assert result["artists"][0]["origin"] == "remote"

    def test_merge_dedupes_by_name(self):
        local = {
            "artists": [{"name": "High Vis", "origin": "local"}],
            "albums": [],
            "tracks": [],
        }
        remote = [
            {
                "artists": [{"name": "High Vis", "origin": "remote", "node_uid": "n1"}],
                "albums": [],
                "tracks": [],
            }
        ]
        result = _merge_results(local, remote)
        assert len(result["artists"]) == 1
        assert result["artists"][0]["origin"] == "local"

    def test_merge_albums_dedupes_by_artist_name_year(self):
        local = {
            "artists": [],
            "albums": [
                {
                    "artist": "High Vis",
                    "name": "Blending",
                    "year": "2022",
                    "origin": "local",
                }
            ],
            "tracks": [],
        }
        remote = [
            {
                "artists": [],
                "albums": [
                    {
                        "artist": "High Vis",
                        "name": "Blending",
                        "year": "2022",
                        "origin": "remote",
                        "node_uid": "n1",
                    }
                ],
                "tracks": [],
            }
        ]
        result = _merge_results(local, remote)
        assert len(result["albums"]) == 1
        assert result["albums"][0]["origin"] == "local"

    def test_merge_keeps_new_remote_album(self):
        local = {
            "artists": [],
            "albums": [
                {"artist": "Birds In Row", "name": "Gris Klein", "year": "2022"}
            ],
            "tracks": [],
        }
        remote = [
            {
                "artists": [],
                "albums": [
                    {
                        "artist": "High Vis",
                        "name": "Blending",
                        "year": "2022",
                        "origin": "remote",
                        "node_uid": "n1",
                    }
                ],
                "tracks": [],
            }
        ]
        result = _merge_results(local, remote)
        assert len(result["albums"]) == 2

    def test_merge_local_first_remote_second(self):
        local = {
            "artists": [{"name": "Local Artist"}],
            "albums": [],
            "tracks": [],
        }
        remote = [
            {
                "artists": [
                    {"name": "Remote Artist", "origin": "remote", "node_uid": "n1"}
                ],
                "albums": [],
                "tracks": [],
            }
        ]
        result = _merge_results(local, remote)
        assert result["artists"][0]["name"] == "Local Artist"
        assert result["artists"][1]["name"] == "Remote Artist"


class TestMatchKeys:
    def test_artist_key_normalized(self):
        assert _artist_match_key({"name": "HIGH VIS"}) == _artist_match_key(
            {"name": "high vis"}
        )

    def test_album_key_normalized(self):
        k1 = _album_match_key(
            {"artist": "High Vis", "name": "Blending", "year": "2022"}
        )
        k2 = _album_match_key(
            {"artist": "high vis", "name": "blending", "year": "2022"}
        )
        assert k1 == k2

    def test_album_key_different_years(self):
        k1 = _album_match_key(
            {"artist": "High Vis", "name": "Blending", "year": "2022"}
        )
        k2 = _album_match_key(
            {"artist": "High Vis", "name": "Blending", "year": "2024"}
        )
        assert k1 != k2


class TestStrongLocalMatches:
    def test_strong_matches(self):
        local = {
            "artists": [{"name": "a1"}],
            "albums": [{"name": "a1", "artist": "b"}],
            "tracks": [{"title": "t1", "artist": "c", "album": "d"}],
        }
        assert _has_strong_local_matches(local) is True

    def test_weak_matches(self):
        local = {"artists": [], "albums": [], "tracks": []}
        assert _has_strong_local_matches(local) is False

    def test_single_match(self):
        local = {
            "artists": [{"name": "a1"}],
            "albums": [],
            "tracks": [],
        }
        assert _has_strong_local_matches(local) is False
