from crate.playlist_blueprints import build_playlist_blueprints


def test_genre_blueprints_prioritize_diversity_and_adjacent_genres():
    blueprints = build_playlist_blueprints(genre_name="screamo")

    primer = blueprints[0]

    assert primer["name"] == "Screamo Core Tracks"
    assert primer["target_type"] == "genre"
    assert primer["smart_rules"]["rules"] == [
        {"field": "genre", "op": "contains", "value": "screamo"}
    ]
    assert primer["smart_rules"]["deduplicate_artist"] is True
    assert primer["smart_rules"]["expand_related_genres"] is True
    assert primer["smart_rules"]["max_per_artist"] == 2


def test_artist_blueprints_are_virtual_smart_rule_drafts():
    blueprints = build_playlist_blueprints(artist_name="Poison The Well")

    essentials = blueprints[0]

    assert essentials["key"] == "artist-essentials"
    assert essentials["name"] == "Poison The Well Core Tracks"
    assert essentials["smart_rules"]["rules"] == [
        {"field": "artist", "op": "eq", "value": "Poison The Well"}
    ]
    assert essentials["smart_rules"]["prefer_studio"] is True
