"""Batch local UID resolution for shared operation target locks."""

from sqlalchemy import text

from crate.db.tx import read_scope


def operation_target_keys(targets: list[dict], *, session=None) -> list[str]:
    if len(targets) > 500:
        raise ValueError("Too many operation targets")
    keys, artists, albums, tracks = set(), [], [], []
    for target in targets:
        kind = target.get("entity_type") or target.get("type")
        uid = (
            target.get("entity_uid")
            or target.get("artist_uid")
            or target.get("album_uid")
            or target.get("track_uid")
        )
        if kind in {"task", "schedule", "runtime", "playlist", "show"}:
            name = target.get("name")
            if not isinstance(name, str) or not name or len(name) > 128:
                raise ValueError("Invalid operational target")
            keys.add(f"{kind}:{name}")
        elif target.get("scope") == "global" or kind == "library":
            keys.add("library:global")
        elif uid:
            kind = kind or (
                "artist"
                if "artist_uid" in target
                else "album"
                if "album_uid" in target
                else "track"
            )
            {"artist": artists, "album": albums, "track": tracks}[kind].append(uid)
            keys.add(f"{kind}:{uid}")

    def _read(current):
        rows = current.execute(
            text("""SELECT DISTINCT 'artist:'||a.entity_uid::text FROM library_artists a
            WHERE a.entity_uid=ANY(CAST(:artists AS uuid[]))
            OR a.name IN (SELECT artist FROM library_albums WHERE entity_uid=ANY(CAST(:albums AS uuid[])))
            OR a.name IN (SELECT b.artist FROM library_tracks t JOIN library_albums b ON b.id=t.album_id
                        WHERE t.entity_uid=ANY(CAST(:tracks AS uuid[])))"""),
            {"artists": artists, "albums": albums, "tracks": tracks},
        ).scalars()
        return sorted(keys | set(rows))

    if not (artists or albums or tracks):
        return sorted(keys)
    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


__all__ = ["operation_target_keys"]
