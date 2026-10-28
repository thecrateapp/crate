from unittest.mock import MagicMock


class _Mappings:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    def __init__(self, results):
        self._results = list(results)

    def execute(self, *_args, **_kwargs):
        rows = self._results.pop(0)
        return MagicMock(mappings=lambda: _Mappings(rows))


def test_sound_intelligence_reports_genre_eq_coverage_and_listening_priorities():
    from crate.db.queries.sound_intelligence import get_sound_intelligence_health

    health = get_sound_intelligence_health(
        session=_Session(
            [
                [
                    {
                        "node_count": 12,
                        "top_level_count": 3,
                        "orphan_count": 1,
                        "missing_description_count": 2,
                        "missing_direct_eq_count": 8,
                        "direct_eq_count": 4,
                        "inherited_eq_count": 3,
                        "missing_effective_eq_count": 5,
                        "unmapped_raw_count": 7,
                        "edge_count": 12,
                        "locked_edge_count": 4,
                        "manual_edge_count": 9,
                        "ai_edge_count": 1,
                        "listening_priorities": [
                            {
                                "slug": "grime",
                                "name": "Grime",
                                "weighted_play_count": 31.5,
                                "listening_share_90d_pct": 4.3,
                            }
                        ],
                    }
                ]
            ]
        )
    )

    assert health["eq"]["total_genres"] == 12
    by_source = {item["source"]: item for item in health["eq"]["sources"]}
    assert by_source["genre_taxonomy_preset"]["percent"] == 33.3
    assert by_source["genre_taxonomy_inherited_preset"]["percent"] == 25.0
    assert by_source["no_genre_eq"]["percent"] == 41.7
    assert health["taxonomy"]["unmapped_raw_count"] == 7
    assert health["taxonomy"]["locked_edge_count"] == 4
    assert health["taxonomy"]["missing_effective_eq_count"] == 5
    assert health["listening_priorities"] == [
        {
            "slug": "grime",
            "name": "Grime",
            "weighted_play_count": 31.5,
            "listening_share_90d_pct": 4.3,
        }
    ]


def test_sound_intelligence_resolves_inherited_eq_and_prioritizes_listened_gaps(pg_db):
    from sqlalchemy import text

    from crate.db.queries.sound_intelligence import get_sound_intelligence_health
    from crate.db.repositories.genres_taxonomy_edges import upsert_genre_taxonomy_edge
    from crate.db.repositories.genres_taxonomy_metadata import set_genre_eq_gains
    from crate.db.repositories.genres_taxonomy_nodes import upsert_genre_taxonomy_node
    from crate.db.tx import transaction_scope

    upsert_genre_taxonomy_node(
        "sound-intelligence-test-parent", name="Sound Intelligence Test Parent"
    )
    upsert_genre_taxonomy_node(
        "sound-intelligence-test-child", name="Sound Intelligence Test Child"
    )
    upsert_genre_taxonomy_node(
        "sound-intelligence-test-uncovered", name="Sound Intelligence Test Uncovered"
    )
    set_genre_eq_gains("sound-intelligence-test-parent", [0.0] * 10)
    upsert_genre_taxonomy_edge(
        "sound-intelligence-test-child",
        "sound-intelligence-test-parent",
        relation_type="parent",
    )

    with transaction_scope() as session:
        user_id = session.execute(
            text(
                "INSERT INTO users (email, created_at) VALUES (:email, NOW()) RETURNING id"
            ),
            {"email": "sound-intelligence-test@example.test"},
        ).scalar_one()
        session.execute(
            text(
                "INSERT INTO user_genre_stats "
                "(user_id, stat_window, genre_name, play_count) "
                "VALUES (:user_id, '90d', :genre_name, 12)"
            ),
            {
                "user_id": user_id,
                "genre_name": "Sound Intelligence Test Uncovered",
            },
        )

    health = get_sound_intelligence_health()

    by_source = {item["source"]: item for item in health["eq"]["sources"]}
    assert by_source["genre_taxonomy_preset"]["count"] >= 1
    assert by_source["genre_taxonomy_inherited_preset"]["count"] >= 1
    assert by_source["no_genre_eq"]["count"] >= 1
    assert (
        health["taxonomy"]["missing_effective_eq_count"]
        == by_source["no_genre_eq"]["count"]
    )
    assert health["listening_priorities"][0] == {
        "slug": "sound-intelligence-test-uncovered",
        "name": "sound intelligence test uncovered",
        "weighted_play_count": 12.0,
        "listening_share_90d_pct": 100.0,
    }
