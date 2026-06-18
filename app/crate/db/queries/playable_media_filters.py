from __future__ import annotations


_HIDDEN_PATH_COMPONENT_REGEX = r"(^|/)\.[^/]+(/|$)"


def playable_album_clause(album_alias: str = "a") -> str:
    return f"""
        {album_alias}.quarantined_at IS NULL
        AND COALESCE({album_alias}.path, '') !~ :hidden_path_component_regex
        AND LOWER(COALESCE({album_alias}.artist, '')) <> '.crate-trash'
        AND LOWER(COALESCE({album_alias}.name, '')) <> '.crate-trash'
    """


def playable_track_clause(
    track_alias: str = "t",
    album_alias: str | None = "a",
) -> str:
    clauses = [
        f"COALESCE({track_alias}.path, '') !~ :hidden_path_component_regex",
        f"LOWER(COALESCE({track_alias}.artist, '')) <> '.crate-trash'",
        f"LOWER(COALESCE({track_alias}.album, '')) <> '.crate-trash'",
    ]
    if album_alias:
        clauses.append(playable_album_clause(album_alias))
    return "\nAND ".join(clauses)


def playable_media_params() -> dict[str, str]:
    return {"hidden_path_component_regex": _HIDDEN_PATH_COMPONENT_REGEX}


__all__ = [
    "playable_album_clause",
    "playable_media_params",
    "playable_track_clause",
]
