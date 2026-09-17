"""Shared per-user media stars and ratings for Listen and OpenSubsonic."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from crate.db.queries.browse_media_favorites import list_favorites
from crate.db.queries.subsonic_global import (
    get_global_album_by_local_id,
    get_global_artist_by_local_id,
    get_global_track_by_local_id,
    get_local_entity_id_by_global_uid,
)
from crate.db.queries.user_library_library import (
    get_followed_artists,
    get_liked_tracks,
    get_saved_albums,
    is_following,
)
from crate.db.repositories.browse_media_favorites import (
    add_favorite,
    remove_favorite,
)
from crate.db.repositories.library_album_reads import get_library_album_by_id
from crate.db.repositories.library_artist_reads import (
    get_library_artist,
    get_library_artist_by_id,
)
from crate.db.repositories.global_user_library import (
    follow_global_artist,
    is_global_album_saved,
    is_global_artist_followed,
    save_global_album,
    unfollow_global_artist,
    unsave_global_album,
)
from crate.db.repositories.user_library_preferences import (
    follow_artist,
    like_track,
    save_album,
    unfollow_artist,
    unlike_track,
    unsave_album,
)
from crate.db.repositories.user_library_shared import resolve_track_reference_read
from crate.db.repositories.user_media_preferences import (
    get_track_rating,
    set_track_rating,
)
from crate.subsonic.global_ids import (
    SubsonicEntityId,
    EntityKind,
    SubsonicIdError,
    decode_subsonic_id,
    encode_subsonic_id,
)
from crate.subsonic.serializers import serialize_album, serialize_song


SubsonicItemKind = Literal["artist", "album", "song"]
_KIND_ALIASES: dict[str, SubsonicItemKind] = {"track": "song", "song": "song"}
_FAVORITE_IDENTITY_COLUMNS = {
    "artist": ("global_catalog_artists", "global_artist_uid", "local_artist_id"),
    "album": ("global_catalog_albums", "global_album_uid", "local_album_id"),
    "song": ("global_catalog_tracks", "global_track_uid", "local_track_id"),
}


def _decode_item(
    item_type: str, item_id: str
) -> tuple[SubsonicItemKind, SubsonicEntityId, str]:
    if item_type in _KIND_ALIASES:
        kind: SubsonicItemKind = _KIND_ALIASES[item_type]
    elif item_type == "artist":
        kind = "artist"
    elif item_type == "album":
        kind = "album"
    else:
        raise ValueError("type must be song, album, or artist")
    entity_kind: EntityKind = "track" if kind == "song" else kind
    raw_id = str(item_id or "").strip()
    if raw_id.isdecimal() and kind in {"artist", "album"}:
        raw_id = ("ar-" if kind == "artist" else "al-") + raw_id
    try:
        entity_id = decode_subsonic_id(raw_id, expected_kind=entity_kind)
    except SubsonicIdError as error:
        raise ValueError("Invalid media ID") from error
    return kind, entity_id, encode_subsonic_id(entity_id)


def _local_artist_name(artist_id: int) -> str | None:
    artist = get_library_artist_by_id(artist_id)
    return str(artist["name"]) if artist is not None else None


def _local_album_exists(album_id: int) -> bool:
    return get_library_album_by_id(album_id) is not None


def _favorite_artist_id(artist_name: str) -> str:
    artist = get_library_artist(artist_name)
    if artist is None or artist.get("id") is None:
        return "name:" + artist_name.casefold()
    artist_id = int(artist["id"])
    global_artist = get_global_artist_by_local_id(artist_id)
    if global_artist:
        return "ga-" + str(global_artist["global_artist_uid"])
    return "ar-" + str(artist_id)


def _favorite_album_id(album_id: int) -> str:
    album = get_global_album_by_local_id(album_id)
    if album:
        return "gal-" + str(album["global_album_uid"])
    return "al-" + str(album_id)


def _favorite_ids_for_entity(
    kind: SubsonicItemKind, entity_id: SubsonicEntityId, canonical_id: str
) -> set[str]:
    aliases = {canonical_id}
    entity_kind: EntityKind = "track" if kind == "song" else kind
    if entity_id.scope == "global" and entity_id.global_uid:
        local_id = get_local_entity_id_by_global_uid(entity_kind, entity_id.global_uid)
        if local_id is not None:
            aliases.add(
                encode_subsonic_id(
                    SubsonicEntityId(
                        kind=entity_kind,
                        scope="local",
                        local_id=local_id,
                    )
                )
            )
    elif entity_id.scope == "local" and entity_id.local_id is not None:
        lookup = {
            "artist": get_global_artist_by_local_id,
            "album": get_global_album_by_local_id,
            "track": get_global_track_by_local_id,
        }[entity_kind]
        global_entity = lookup(entity_id.local_id)
        global_uid = (
            global_entity.get(f"global_{entity_kind}_uid")
            if global_entity is not None
            else None
        )
        if global_uid:
            aliases.add(
                encode_subsonic_id(
                    SubsonicEntityId(
                        kind=entity_kind,
                        scope="global",
                        global_uid=str(global_uid),
                    )
                )
            )
    return aliases


def follow_artist_for_user(user_id: int, artist_name: str) -> bool:
    changed = follow_artist(user_id, artist_name)
    add_favorite(
        user_id,
        "artist",
        _favorite_artist_id(artist_name),
        datetime.now(timezone.utc).isoformat(),
    )
    return changed


def unfollow_artist_for_user(user_id: int, artist_name: str) -> bool:
    changed = unfollow_artist(user_id, artist_name)
    removed = remove_favorite(user_id, "artist", _favorite_artist_id(artist_name))
    return changed or removed


def save_album_for_user(user_id: int, album_id: int) -> bool:
    changed = save_album(user_id, album_id)
    add_favorite(
        user_id,
        "album",
        _favorite_album_id(album_id),
        datetime.now(timezone.utc).isoformat(),
    )
    return changed


def unsave_album_for_user(user_id: int, album_id: int) -> bool:
    changed = unsave_album(user_id, album_id)
    removed = remove_favorite(user_id, "album", _favorite_album_id(album_id))
    return changed or removed


def star(user_id: int, item_type: str, item_id: str) -> bool:
    """Star a canonical or local entity and mirror the Listen collection state."""
    kind, entity_id, canonical_id = _decode_item(item_type, item_id)
    changed: bool | None
    if kind == "artist":
        if entity_id.scope == "global":
            uid = str(entity_id.global_uid)
            changed = follow_global_artist(user_id, uid)
            exists = is_global_artist_followed(user_id, uid)
        else:
            artist_name = _local_artist_name(int(entity_id.local_id or 0))
            if artist_name is None:
                return False
            changed = follow_artist(user_id, artist_name)
            exists = is_following(user_id, artist_name)
    elif kind == "album":
        if entity_id.scope == "global":
            uid = str(entity_id.global_uid)
            changed = save_global_album(user_id, uid)
            exists = is_global_album_saved(user_id, uid)
        else:
            album_id = int(entity_id.local_id or 0)
            if not _local_album_exists(album_id):
                return False
            changed = save_album(user_id, album_id)
            exists = True
    elif entity_id.scope == "global":
        changed = like_track(user_id, global_track_uid=str(entity_id.global_uid))
        exists = changed is not None
    else:
        changed = like_track(user_id, track_id=int(entity_id.local_id or 0))
        exists = changed is not None

    if not exists:
        return False
    created_at = datetime.now(timezone.utc).isoformat()
    favorited = add_favorite(user_id, kind, canonical_id, created_at)
    return bool(changed) or favorited


def star_track_reference(
    user_id: int,
    *,
    global_track_uid: str | None = None,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    track_path: str | None = None,
) -> bool | None:
    changed = like_track(
        user_id,
        global_track_uid=global_track_uid,
        track_id=track_id,
        track_entity_uid=track_entity_uid,
        track_path=track_path,
    )
    if changed is None:
        return None
    reference = resolve_track_reference_read(
        track_id=track_id,
        track_entity_uid=track_entity_uid,
        track_path=track_path,
    )
    resolved_id = global_track_uid
    resolved_track_id = int(reference["track_id"]) if reference else track_id
    if resolved_id is None and resolved_track_id is not None:
        from crate.db.queries.subsonic_global import get_global_track_by_local_id

        track = get_global_track_by_local_id(resolved_track_id)
        resolved_id = str(track["global_track_uid"]) if track else None
    if resolved_id:
        favorite_id = "gt-" + str(resolved_id)
    elif resolved_track_id is not None:
        favorite_id = str(resolved_track_id)
    else:
        if reference is None:
            return None
        favorite_id = str(int(reference["track_id"]))
    add_favorite(
        user_id,
        "song",
        favorite_id,
        datetime.now(timezone.utc).isoformat(),
    )
    return bool(changed)


def unstar_track_reference(
    user_id: int,
    *,
    global_track_uid: str | None = None,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    track_path: str | None = None,
) -> bool:
    reference = resolve_track_reference_read(
        track_id=track_id,
        track_entity_uid=track_entity_uid,
        track_path=track_path,
    )
    resolved_track_id = int(reference["track_id"]) if reference else track_id
    resolved_global_uid = global_track_uid
    if resolved_global_uid is None and resolved_track_id is not None:
        from crate.db.queries.subsonic_global import get_global_track_by_local_id

        track = get_global_track_by_local_id(resolved_track_id)
        resolved_global_uid = str(track["global_track_uid"]) if track else None
    removed = unlike_track(
        user_id,
        global_track_uid=global_track_uid,
        track_id=track_id,
        track_entity_uid=track_entity_uid,
        track_path=track_path,
    )
    if resolved_global_uid:
        entity_id = SubsonicEntityId(
            kind="track", scope="global", global_uid=resolved_global_uid
        )
        canonical_id = "gt-" + resolved_global_uid
    elif resolved_track_id is not None:
        entity_id = SubsonicEntityId(
            kind="track", scope="local", local_id=resolved_track_id
        )
        canonical_id = str(resolved_track_id)
    else:
        entity_id = None
        canonical_id = ""
    if entity_id is not None:
        for favorite_id in _favorite_ids_for_entity("song", entity_id, canonical_id):
            removed = remove_favorite(user_id, "song", favorite_id) or removed
    return removed


def unstar(user_id: int, item_type: str, item_id: str) -> bool:
    kind, entity_id, canonical_id = _decode_item(item_type, item_id)
    if kind == "artist":
        if entity_id.scope == "global":
            changed = unfollow_global_artist(user_id, str(entity_id.global_uid))
        else:
            artist_name = _local_artist_name(int(entity_id.local_id or 0))
            changed = unfollow_artist(user_id, artist_name) if artist_name else False
    elif kind == "album":
        if entity_id.scope == "global":
            changed = unsave_global_album(user_id, str(entity_id.global_uid))
        else:
            changed = unsave_album(user_id, int(entity_id.local_id or 0))
    elif entity_id.scope == "global":
        changed = unlike_track(user_id, global_track_uid=str(entity_id.global_uid))
    else:
        changed = unlike_track(user_id, track_id=int(entity_id.local_id or 0))
    removed = False
    for favorite_id in _favorite_ids_for_entity(kind, entity_id, canonical_id):
        removed = remove_favorite(user_id, kind, favorite_id) or removed
    return bool(changed) or removed


def set_rating(user_id: int, item_id: str, rating: int) -> bool:
    kind, entity_id, _ = _decode_item("song", item_id)
    if kind != "song":
        raise ValueError("Rating can only be set for songs")
    return set_track_rating(
        user_id,
        entity_id.local_id if entity_id.scope == "local" else None,
        rating,
        global_track_uid=(
            str(entity_id.global_uid) if entity_id.scope == "global" else None
        ),
    )


def set_native_track_rating(user_id: int, track_id: int, rating: int) -> bool:
    return set_track_rating(user_id, track_id, rating)


def get_rating(user_id: int, track_id: int | str) -> int:
    if isinstance(track_id, str):
        try:
            _, entity_id, _ = _decode_item("song", track_id)
        except ValueError:
            return 0
        return get_track_rating(
            user_id,
            entity_id.local_id if entity_id.scope == "local" else None,
            global_track_uid=(
                str(entity_id.global_uid) if entity_id.scope == "global" else None
            ),
        )
    return get_track_rating(user_id, track_id)


def with_user_rating(user_id: int, song: dict[str, Any]) -> dict[str, Any]:
    payload = dict(song)
    rating = get_rating(user_id, str(payload.get("id") or ""))
    if rating:
        payload["userRating"] = rating
    else:
        payload.pop("userRating", None)
    return payload


def get_starred(user_id: int) -> dict[str, list[dict[str, Any]]]:
    artists = []
    for artist in get_followed_artists(user_id):
        artist_id = (
            "ga-" + str(artist["global_artist_uid"])
            if artist.get("global_artist_uid")
            else "ar-" + str(artist.get("artist_id"))
        )
        if artist_id.endswith("None"):
            continue
        payload = {
            "id": artist_id,
            "name": str(artist.get("artist_name") or ""),
            "albumCount": int(artist.get("album_count") or 0),
        }
        if artist.get("has_photo"):
            payload["coverArt"] = artist_id
        artists.append(payload)

    albums = [serialize_album(album) for album in get_saved_albums(user_id)]
    songs = []
    for track in get_liked_tracks(user_id, limit=1000):
        starred = track.get("liked_at")
        global_uid = track.get("global_track_uid")
        track_id = track.get("track_id")
        track["starred"] = starred
        track["user_rating"] = get_track_rating(
            user_id,
            int(track_id) if track_id is not None else None,
            global_track_uid=str(global_uid) if global_uid else None,
        )
        songs.append(serialize_song(track))

    result = {"artist": artists, "album": albums, "song": songs}
    _include_legacy_favorites(user_id, result)
    return result


def _include_legacy_favorites(
    user_id: int, result: dict[str, list[dict[str, Any]]]
) -> None:
    from crate.subsonic.services import catalog

    seen = {
        kind: {str(item.get("id")) for item in items} for kind, items in result.items()
    }
    for favorite in list_favorites(user_id):
        try:
            kind, entity_id, identifier = _decode_item(
                str(favorite["item_type"]), str(favorite["item_id"])
            )
        except ValueError:
            continue
        if identifier in seen[kind]:
            continue
        if kind == "artist":
            detail = catalog.artist_detail(identifier)
            if detail is None:
                continue
            payload = {
                "id": detail["id"],
                "name": detail["name"],
                "albumCount": len(detail.get("album") or []),
            }
            if detail.get("coverArt"):
                payload["coverArt"] = detail["coverArt"]
        elif kind == "album":
            detail = catalog.album_detail(identifier)
            if detail is None:
                continue
            payload = {key: value for key, value in detail.items() if key != "song"}
        else:
            detail = catalog.song_detail(identifier)
            if detail is None:
                continue
            detail["starred"] = favorite.get("created_at")
            detail["user_rating"] = get_track_rating(
                user_id,
                entity_id.local_id if entity_id.scope == "local" else None,
                global_track_uid=(
                    str(entity_id.global_uid) if entity_id.scope == "global" else None
                ),
            )
            payload = serialize_song(detail)
        resolved_identifier = str(payload.get("id") or identifier)
        if resolved_identifier in seen[kind]:
            continue
        result[kind].append(payload)
        seen[kind].update((identifier, resolved_identifier))


__all__ = [
    "follow_artist_for_user",
    "get_rating",
    "get_starred",
    "save_album_for_user",
    "set_native_track_rating",
    "set_rating",
    "star",
    "star_track_reference",
    "unfollow_artist_for_user",
    "unstar",
    "unstar_track_reference",
    "unsave_album_for_user",
    "with_user_rating",
]
