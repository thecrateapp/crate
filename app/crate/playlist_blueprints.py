"""Virtual editorial playlist blueprints.

Blueprints are suggestions only: they do not materialize playlists until an
admin explicitly creates/publishes one from the returned smart rules.
"""

from typing import Literal, TypedDict

from crate.slugs import slugify


class PlaylistBlueprint(TypedDict):
    key: str
    name: str
    description: str
    target_type: Literal["artist", "genre"]
    category: str
    smart_rules: dict


def _rule(field: str, value: str, op: str = "eq") -> dict:
    return {"field": field, "op": op, "value": value}


def build_artist_blueprints(artist_name: str) -> list[PlaylistBlueprint]:
    name = artist_name.strip()
    if not name:
        return []
    return [
        {
            "key": "artist-essentials",
            "name": f"{name} Core Tracks",
            "description": f"The clearest entry point into {name}.",
            "target_type": "artist",
            "category": "artist",
            "smart_rules": {
                "match": "all",
                "rules": [_rule("artist", name)],
                "limit": 40,
                "sort": "popularity",
                "deduplicate_titles": True,
                "prefer_studio": True,
                "max_per_album": 4,
            },
        },
        {
            "key": "artist-deep-cuts",
            "name": f"{name} Deep Cuts",
            "description": f"A wider route through lesser-played {name} tracks.",
            "target_type": "artist",
            "category": "artist",
            "smart_rules": {
                "match": "all",
                "rules": [_rule("artist", name)],
                "limit": 36,
                "sort": "least_played",
                "deduplicate_titles": True,
                "prefer_studio": True,
                "max_per_album": 3,
            },
        },
    ]


def build_genre_blueprints(genre_name: str) -> list[PlaylistBlueprint]:
    name = genre_name.strip()
    if not name:
        return []
    display = name.replace("-", " ").title()
    return [
        {
            "key": "genre-primer",
            "name": f"{display} Core Tracks",
            "description": f"A focused primer for the strongest {display} tracks in your library.",
            "target_type": "genre",
            "category": "genre",
            "smart_rules": {
                "match": "all",
                "rules": [_rule("genre", name, "contains")],
                "limit": 50,
                "sort": "popularity",
                "deduplicate_titles": True,
                "deduplicate_artist": True,
                "expand_related_genres": True,
                "prefer_studio": True,
                "max_per_artist": 2,
                "max_per_album": 2,
            },
        },
        {
            "key": "genre-adjacent-scenes",
            "name": f"{display} Adjacent Scenes",
            "description": f"{display} and neighboring sounds without overloading a single band.",
            "target_type": "genre",
            "category": "genre",
            "smart_rules": {
                "match": "all",
                "rules": [_rule("genre", name, "contains")],
                "limit": 60,
                "sort": "random",
                "deduplicate_titles": True,
                "deduplicate_artist": True,
                "expand_related_genres": True,
                "prefer_studio": True,
                "max_per_artist": 1,
                "max_per_album": 2,
            },
        },
    ]


def build_playlist_blueprints(
    *, artist_name: str | None = None, genre_name: str | None = None
) -> list[PlaylistBlueprint]:
    blueprints: list[PlaylistBlueprint] = []
    if artist_name:
        blueprints.extend(build_artist_blueprints(artist_name))
    if genre_name:
        blueprints.extend(build_genre_blueprints(genre_name))
    return blueprints


def blueprint_curation_key(blueprint: PlaylistBlueprint, target_name: str) -> str:
    target_type = blueprint["target_type"]
    target_slug = slugify(target_name, "target")
    return f"blueprint:{target_type}:{target_slug}:{blueprint['key']}"


def find_playlist_blueprint(
    *, target_type: Literal["artist", "genre"], target_name: str, blueprint_key: str
) -> PlaylistBlueprint | None:
    blueprints = build_playlist_blueprints(
        artist_name=target_name if target_type == "artist" else None,
        genre_name=target_name if target_type == "genre" else None,
    )
    return next(
        (blueprint for blueprint in blueprints if blueprint["key"] == blueprint_key),
        None,
    )
