import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _similar(rows: list[tuple[str, str, float, bool]]) -> None:
    from sqlalchemy import text

    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        for artist, similar, score, in_library in rows:
            session.execute(
                text(
                    "INSERT INTO artist_similarities "
                    "(artist_name, similar_name, score, in_library, updated_at) "
                    "VALUES (:a, :b, :s, :l, NOW())"
                ),
                {"a": artist, "b": similar, "s": score, "l": in_library},
            )


class TestArtistNetwork:
    def test_matches_names_case_insensitively(self, pg_db):
        from crate.db.similarity_network import get_artist_network

        pg_db.upsert_artist({"name": "Pixies"})
        _similar([("Pixies", "The Breeders", 0.9, False)])

        network = get_artist_network("pixies", depth=1)

        assert {node["id"] for node in network["nodes"]} == {"pixies", "The Breeders"}
        assert network["links"] == [
            {"source": "pixies", "target": "The Breeders", "value": 0.9}
        ]

    def test_external_artist_expands_to_library_artists_listing_it(self, pg_db):
        from crate.db.similarity_network import get_artist_network

        pg_db.upsert_artist({"name": "Pixies"})
        pg_db.upsert_artist({"name": "Sonic Youth"})
        _similar(
            [
                ("Pixies", "The Breeders", 0.9, False),
                ("Sonic Youth", "The Breeders", 0.6, False),
            ]
        )

        network = get_artist_network("The Breeders", depth=1)

        nodes = {node["id"]: node for node in network["nodes"]}
        assert set(nodes) == {"The Breeders", "Pixies", "Sonic Youth"}
        assert nodes["Pixies"]["in_library"] is True
        assert nodes["Pixies"]["score"] == 0.9

    def test_second_level_is_capped_per_parent_and_keeps_existing_links(self, pg_db):
        from crate.db.similarity_network import get_artist_network

        pg_db.upsert_artist({"name": "Pixies"})
        pg_db.upsert_artist({"name": "Breeders"})
        _similar(
            [
                ("Pixies", "Breeders", 0.9, True),
                ("Pixies", "Throwing Muses", 0.7, False),
                ("Breeders", "Throwing Muses", 0.8, False),
                ("Breeders", "Belly", 0.6, False),
                ("Breeders", "Amps", 0.5, False),
            ]
        )

        network = get_artist_network("Pixies", depth=2, limit_per_level=1)

        ids = {node["id"] for node in network["nodes"]}
        assert {"Pixies", "Breeders"} <= ids
        assert len(ids) <= 4
        link_pairs = {
            tuple(sorted((link["source"], link["target"]))) for link in network["links"]
        }
        assert ("Pixies", "Throwing Muses") in link_pairs or (
            "Breeders",
            "Throwing Muses",
        ) in link_pairs


class TestNetworkArtistCard:
    def test_library_artist_card_uses_precomputed_counts_and_genres(self, pg_db):
        from crate.db.queries.artist_network_card import get_network_artist_card

        pg_db.upsert_artist({"name": "Pixies", "album_count": 7, "track_count": 96})
        _similar([("Sonic Youth", "Pixies", 0.7, True)])

        card = get_network_artist_card("pixies")

        assert card["in_library"] is True
        assert card["name"] == "Pixies"
        assert card["album_count"] == 7
        assert card["track_count"] == 96
        assert card["linked_by"] == [
            {
                "name": "Sonic Youth",
                "score": 0.7,
                "artist_id": None,
                "artist_slug": None,
            }
        ]

    def test_external_artist_card_lists_library_artists_pointing_to_it(self, pg_db):
        from crate.db.queries.artist_network_card import get_network_artist_card

        pg_db.upsert_artist({"name": "Pixies"})
        _similar(
            [
                ("Pixies", "The Breeders", 0.9, False),
                ("Pixies", "the breeders", 0.4, False),
            ]
        )

        card = get_network_artist_card("The Breeders")

        assert card["in_library"] is False
        assert card["artist_id"] is None
        assert card["name"] == "The Breeders"
        assert [item["name"] for item in card["linked_by"]] == ["Pixies"]
        assert card["linked_by"][0]["score"] == 0.9
        assert card["linked_by"][0]["artist_id"] is not None
