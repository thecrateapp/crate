import base64
import io as _io
import logging
import time
from pathlib import Path
from typing import cast

from crate.artwork_materializer import materialize_artwork
from crate.artwork_maintenance import (
    cleanup_artwork_variants,
    find_corrupt_artwork_assets,
    repair_artwork_manifest_permissions,
)
from crate.artwork_sources import resolve_artwork_source
from crate.artwork_tasks import queue_artwork_materialization
from crate.artwork_tasks import (
    ARTWORK_BACKFILL_VERSION,
    ARTWORK_MANIFEST_PERMISSIONS_VERSION,
)
from crate.artwork_variants import (
    ARTWORK_KINDS,
    ArtworkAsset,
    ArtworkKind,
    external_artist_asset,
)
from crate.db.cache_store import set_cache
from crate.db.events import emit_task_event
from crate.db.queries.artwork_backfill import (
    list_artwork_backfill_albums,
    list_artwork_backfill_artists,
    list_artwork_backfill_genres,
)
from crate.db.repositories.library import (
    get_library_album,
    get_library_album_by_id,
    get_library_artist,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.db.releases import update_new_release_cover
from crate.release_covers import release_cover_abspath, release_cover_public_url
from crate.metrics import record_later
from crate.task_progress import TaskProgress, emit_progress, entity_label
from crate.db.jobs.artwork import (
    set_album_has_cover,
    set_artist_has_photo,
    touch_artist_artwork,
)
from crate.storage_layout import resolve_artist_dir
from crate.worker_handlers import (
    DEFAULT_AUDIO_EXTENSIONS,
    TaskHandler,
    is_cancelled,
    start_scan,
)

log = logging.getLogger(__name__)


def _handle_materialize_artwork_variants(
    task_id: str, params: dict, config: dict
) -> dict:
    del config
    allowed_params = {"kind", "entity_key", "reason"}
    if set(params) - allowed_params:
        return {"error": "Unsupported artwork task parameters"}

    kind = str(params.get("kind") or "")
    entity_key = str(params.get("entity_key") or "")
    if kind not in ARTWORK_KINDS:
        return {"error": "Unsupported artwork kind"}
    try:
        asset = ArtworkAsset(cast(ArtworkKind, kind), entity_key)
    except ValueError as exc:
        return {"error": str(exc)}

    emit_progress(
        task_id,
        TaskProgress(phase="resolve_artwork_source", done=0, total=1),
        force=True,
    )
    reason = str(params.get("reason") or "")
    source = resolve_artwork_source(
        asset,
        allow_provider=reason not in {"backfill", "integrity-repair"},
    )
    if source is None:
        return {
            "status": "missing",
            "kind": asset.kind,
            "entity_key": asset.entity_key,
        }

    materialized = materialize_artwork(
        asset,
        source.content,
        source_media_type=source.media_type,
    )
    emit_progress(
        task_id,
        TaskProgress(phase="materialize_artwork", done=1, total=1),
        force=True,
    )
    return {
        "status": "materialized",
        "kind": asset.kind,
        "entity_key": asset.entity_key,
        "origin": source.origin,
        "revision": materialized.get("source_revision"),
        "variant_count": int(materialized.get("variant_count") or 0),
    }


def _handle_backfill_artwork_variants(task_id: str, params: dict, config: dict) -> dict:
    del config
    batch_size = max(1, min(int(params.get("batch_size") or 100), 1000))
    after_artist_id = max(0, int(params.get("after_artist_id") or 0))
    after_album_id = max(0, int(params.get("after_album_id") or 0))
    include_genres = bool(params.get("include_genres", True))
    after_genre_slug = str(params.get("after_genre_slug") or "").strip().lower()

    artists = list_artwork_backfill_artists(after_id=after_artist_id, limit=batch_size)
    albums = list_artwork_backfill_albums(after_id=after_album_id, limit=batch_size)
    genres = (
        list_artwork_backfill_genres(after_slug=after_genre_slug, limit=batch_size)
        if include_genres
        else []
    )
    total_assets = len(artists) * 2 + len(albums) + len(genres)
    progress = TaskProgress(phase="artwork_backfill", phase_count=1, total=total_assets)
    emit_progress(task_id, progress, force=True)

    queued = 0
    skipped_missing_identity = 0
    for row in artists:
        entity_uid = str(row.get("entity_uid") or "")
        if not entity_uid:
            skipped_missing_identity += 1
            continue
        for kind in ("artist-photo", "artist-background"):
            queue_artwork_materialization(
                ArtworkAsset(cast(ArtworkKind, kind), entity_uid), reason="backfill"
            )
            queued += 1
            progress.done += 1

    for row in albums:
        entity_uid = str(row.get("entity_uid") or "")
        if not entity_uid:
            skipped_missing_identity += 1
            continue
        queue_artwork_materialization(
            ArtworkAsset("album-cover", entity_uid), reason="backfill"
        )
        queued += 1
        progress.done += 1

    for row in genres:
        slug = str(row.get("slug") or "")
        if not slug:
            skipped_missing_identity += 1
            continue
        queue_artwork_materialization(
            ArtworkAsset("genre-cover", slug), reason="backfill"
        )
        queued += 1
        progress.done += 1

    emit_progress(task_id, progress, force=True)
    next_artist_id = int(artists[-1]["id"]) if artists else after_artist_id
    next_album_id = int(albums[-1]["id"]) if albums else after_album_id
    next_genre_slug = str(genres[-1]["slug"]) if genres else after_genre_slug
    has_next_page = (
        len(artists) >= batch_size
        or len(albums) >= batch_size
        or (include_genres and len(genres) >= batch_size)
    )
    if has_next_page:
        next_params = {
            "after_artist_id": next_artist_id,
            "after_album_id": next_album_id,
            "batch_size": batch_size,
            "include_genres": include_genres,
        }
        if include_genres:
            next_params["after_genre_slug"] = next_genre_slug
        cursor_key = f"{next_artist_id}:{next_album_id}"
        if include_genres:
            cursor_key += f":{next_genre_slug}"
        create_task_dedup(
            "backfill_artwork_variants",
            next_params,
            dedup_key=(
                f"artwork-backfill:{cursor_key}:{batch_size}:{int(include_genres)}"
            ),
        )

    for kind, remaining in (
        ("artist", len(artists) >= batch_size),
        ("album", len(albums) >= batch_size),
        ("genre", include_genres and len(genres) >= batch_size),
    ):
        record_later(
            "artwork.backfill.remaining",
            1.0 if remaining else 0.0,
            {"kind": kind},
        )

    if not has_next_page:
        try:
            from crate.db.cache_settings import set_setting

            set_setting("artwork_variants_backfill_version", ARTWORK_BACKFILL_VERSION)
        except Exception:
            log.warning("Failed to persist artwork backfill completion", exc_info=True)

    return {
        "status": "continued" if has_next_page else "completed",
        "artists_seen": len(artists),
        "albums_seen": len(albums),
        "genres_seen": len(genres),
        "queued": queued,
        "skipped_missing_identity": skipped_missing_identity,
        "next_queued": has_next_page,
        "after_artist_id": next_artist_id,
        "after_album_id": next_album_id,
    }


def _handle_cleanup_artwork_variants(task_id: str, params: dict, config: dict) -> dict:
    del task_id, config
    max_assets = max(1, min(int(params.get("max_assets") or 10_000), 100_000))
    return cleanup_artwork_variants(max_assets=max_assets)


def _handle_repair_artwork_variants(task_id: str, params: dict, config: dict) -> dict:
    del task_id, config
    max_assets = max(1, min(int(params.get("max_assets") or 1000), 100_000))
    corrupt = find_corrupt_artwork_assets(max_assets=max_assets)
    for asset in corrupt:
        queue_artwork_materialization(asset, reason="integrity-repair")
    result = {"assets_checked": max_assets, "requeued": len(corrupt)}
    if bool(params.get("repair_manifest_permissions")):
        permissions = repair_artwork_manifest_permissions(max_assets=max_assets)
        result.update(
            {
                "manifest_assets_checked": permissions["assets_checked"],
                "permissions_repaired": permissions["permissions_repaired"],
            }
        )
        from crate.db.cache_settings import set_setting

        set_setting(
            "artwork_manifest_permissions_version",
            ARTWORK_MANIFEST_PERMISSIONS_VERSION,
        )
    return result


def _handle_resolve_external_artist_artwork(
    task_id: str, params: dict, config: dict
) -> dict:
    del task_id, config
    artist_name = str(params.get("artist_name") or "").strip()
    if not artist_name:
        return {"error": "Artist name is required"}

    from crate.external_artist_artwork import (
        mark_external_artist_artwork_missing,
        persist_external_artist_artwork,
        resolve_external_artist_artwork,
    )

    image = resolve_external_artist_artwork(artist_name)
    if not image:
        mark_external_artist_artwork_missing(artist_name)
        return {"status": "missing", "artist_name": artist_name}

    try:
        persist_external_artist_artwork(artist_name, image)
    except (OSError, RuntimeError, ValueError):
        log.debug("External artwork persistence failed for %s", artist_name)
        mark_external_artist_artwork_missing(artist_name)
        return {"status": "missing", "artist_name": artist_name}

    materialize_artwork(
        external_artist_asset(artist_name),
        image,
        source_media_type="image/jpeg",
    )

    return {"status": "cached", "artist_name": artist_name}


def _handle_fetch_artwork_all(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover, scan_missing_covers

    lib = Path(config["library_path"])
    missing = scan_missing_covers(lib, DEFAULT_AUDIO_EXTENSIONS)

    fetched = 0
    failed = 0
    total = len(missing)

    p = TaskProgress(phase="fetching_covers", phase_count=1, total=total)

    for i, album in enumerate(missing):
        if is_cancelled(task_id):
            break
        mbid = album.get("mbid")
        if not mbid:
            continue
        p.done = i + 1
        p.item = entity_label(
            artist=album.get("artist", ""),
            album=album.get("album", ""),
            path=album.get("path", ""),
        )
        emit_progress(task_id, p)
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(Path(album["path"]), image)
            fetched += 1
        else:
            failed += 1

    emit_task_event(
        task_id,
        "info",
        {"message": f"Artwork fetch complete: {fetched}/{total} covers fetched"},
    )
    return {"fetched": fetched, "failed": failed, "total": total}


def _handle_batch_covers(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover

    lib = Path(config["library_path"])
    albums = params.get("albums", [])
    results = []

    p = TaskProgress(phase="batch_covers", phase_count=1, total=len(albums))

    for i, item in enumerate(albums):
        if is_cancelled(task_id):
            break
        mbid = item.get("mbid")
        path = item.get("path")
        p.done = i + 1
        p.item = entity_label(path=path or "")
        emit_progress(task_id, p)

        if not mbid:
            results.append({"path": path, "error": "No MBID"})
            continue

        album_dir = lib / path
        if not album_dir.is_dir():
            results.append({"path": path, "error": "Not found"})
            continue

        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(album_dir, image)
            results.append({"path": path, "status": "fetched"})
        else:
            results.append({"path": path, "error": "Not found on CAA"})

    fetched = sum(1 for r in results if r.get("status") == "fetched")
    emit_task_event(
        task_id, "info", {"message": f"Batch covers: fetched {fetched}/{len(albums)}"}
    )
    return {"results": results}


def _handle_fetch_cover(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover

    mbid = params.get("mbid")
    path = params.get("path")
    if not mbid:
        return {"error": "No MBID"}

    emit_task_event(
        task_id,
        "info",
        {"message": f"Fetching cover from CoverArtArchive for {path or mbid}"},
    )

    lib = Path(config["library_path"])
    album_dir = lib / path if path else None

    image = fetch_cover_from_caa(mbid)
    if not image:
        emit_task_event(
            task_id, "info", {"message": f"No cover found on CAA for {path or mbid}"}
        )
        return {"error": "No cover found on CAA"}

    if album_dir and album_dir.is_dir():
        save_cover(album_dir, image)
        emit_task_event(task_id, "info", {"message": f"Cover saved for {path or mbid}"})
        return {"status": "saved", "path": str(album_dir / "cover.jpg")}

    return {"error": "Album directory not found"}


def _handle_fetch_artist_covers(task_id: str, params: dict, config: dict) -> dict:
    from crate.audio import read_tags as _read_tags
    from crate.audio import get_audio_files
    from crate.artwork import fetch_cover_from_caa, save_cover

    artist_name = params.get("artist", "")
    lib = Path(config["library_path"])
    artist_row = get_library_artist(artist_name)
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist_name, existing_only=True
    )
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))

    if not artist_dir or not artist_dir.is_dir():
        return {"error": "Artist not found"}

    fetched = failed = skipped = total = 0
    p = TaskProgress(
        phase="artist_covers", phase_count=1, item=entity_label(artist=artist_name)
    )
    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        total += 1
        p.total = total
        if (album_dir / "cover.jpg").exists():
            skipped += 1
            continue
        tracks = get_audio_files(album_dir, exts)
        if not tracks:
            skipped += 1
            continue
        tags = _read_tags(tracks[0])
        mbid = tags.get("musicbrainz_albumid")
        if not mbid:
            skipped += 1
            continue
        p.done = total
        p.item = entity_label(artist=artist_name, album=album_dir.name)
        emit_progress(task_id, p)
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(album_dir, image)
            fetched += 1
        else:
            failed += 1

    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Artist covers for {artist_name}: {fetched}/{total} fetched, {skipped} skipped"
        },
    )
    return {"fetched": fetched, "failed": failed, "skipped": skipped, "total": total}


def _fetch_deezer_cover(artist: str, album: str) -> bytes | None:
    try:
        import requests as _requests

        resp = _requests.get(
            "https://api.deezer.com/search/album",
            params={"q": f"{artist} {album}", "limit": 5},
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        for item in resp.json().get("data", []):
            if item.get("cover_xl"):
                img_resp = _requests.get(item["cover_xl"], timeout=10)
                if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                    return img_resp.content
    except Exception:
        return None
    return None


def _fetch_itunes_cover(artist: str, album: str) -> bytes | None:
    try:
        import requests as _requests

        resp = _requests.get(
            "https://itunes.apple.com/search",
            params={
                "term": f"{artist} {album}",
                "media": "music",
                "entity": "album",
                "limit": 5,
            },
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        for item in resp.json().get("results", []):
            art_url = item.get("artworkUrl100", "").replace("100x100", "600x600")
            if art_url:
                img_resp = _requests.get(art_url, timeout=10)
                if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                    return img_resp.content
    except Exception:
        return None
    return None


def _fetch_lastfm_cover(artist: str, album: str) -> bytes | None:
    try:
        from crate.popularity import _lastfm_get
        import requests as _requests

        data = _lastfm_get("album.getinfo", artist=artist, album=album, autocorrect="1")
        if not data or "album" not in data:
            return None
        images = data["album"].get("image", [])
        for img in reversed(images):
            url = img.get("#text", "")
            if url and "noimage" not in url:
                img_resp = _requests.get(url, timeout=10)
                if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                    return img_resp.content
    except Exception:
        return None
    return None


def _search_musicbrainz_cover(artist: str, album: str) -> bytes | None:
    try:
        import musicbrainzngs
        from crate.artwork import fetch_cover_from_caa

        results = musicbrainzngs.search_releases(artist=artist, release=album, limit=3)
        for release in results.get("release-list", []):
            found_mbid = release.get("id")
            if found_mbid:
                caa_data = fetch_cover_from_caa(found_mbid)
                if caa_data:
                    return caa_data
            time.sleep(0.5)
    except Exception:
        return None
    return None


def _handle_scan_missing_covers(task_id: str, params: dict, config: dict) -> dict:
    """Scan for missing covers, search sources, emit events for each find."""
    from crate.artwork import (
        extract_embedded_cover,
        fetch_cover_from_caa,
        save_cover,
        scan_missing_covers,
    )

    lib = Path(config["library_path"])

    p = TaskProgress(phase="scanning", phase_count=2)
    emit_progress(task_id, p, force=True)
    emit_task_event(
        task_id, "info", {"message": "Scanning library for missing covers..."}
    )
    missing = scan_missing_covers(lib, DEFAULT_AUDIO_EXTENSIONS)

    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Found {len(missing)} albums without covers",
            "total": len(missing),
        },
    )

    found = 0
    not_found = 0
    p.phase = "searching"
    p.phase_index = 1
    p.total = len(missing)

    for i, album in enumerate(missing):
        if is_cancelled(task_id):
            break

        artist = album["artist"]
        album_name = album["album"]
        mbid = album.get("mbid")
        album_path = album["path"]

        p.done = i
        p.item = entity_label(artist=artist, album=album_name)
        emit_progress(task_id, p)

        cover_data = None
        source = None

        if mbid and mbid.strip():
            cover_data = fetch_cover_from_caa(mbid)
            if cover_data:
                source = "coverartarchive"

        if not cover_data:
            audio_files = list(Path(album_path).glob("*.flac")) + list(
                Path(album_path).glob("*.mp3")
            )
            for audio_file in audio_files[:1]:
                embedded = extract_embedded_cover(audio_file)
                if embedded:
                    cover_data = embedded
                    source = "embedded"
                    break

        if not cover_data:
            cover_data = _fetch_deezer_cover(artist, album_name)
            if cover_data:
                source = "deezer"

        if not cover_data:
            cover_data = _fetch_itunes_cover(artist, album_name)
            if cover_data:
                source = "itunes"

        if not cover_data:
            cover_data = _fetch_lastfm_cover(artist, album_name)
            if cover_data:
                source = "lastfm"

        if not cover_data and not (mbid and mbid.strip()):
            cover_data = _search_musicbrainz_cover(artist, album_name)
            if cover_data:
                source = "coverartarchive"

        if cover_data:
            found += 1
            emit_task_event(
                task_id,
                "cover_found",
                {
                    "message": f"Cover found: {artist} / {album_name} ({source})",
                    "artist": artist,
                    "album": album_name,
                    "path": album_path,
                    "source": source,
                    "size": len(cover_data),
                    "index": i,
                },
            )
            set_cache(
                f"pending_cover:{task_id}:{i}",
                {
                    "artist": artist,
                    "album": album_name,
                    "path": album_path,
                    "source": source,
                    "applied": False,
                },
            )
            if params.get("auto_apply"):
                save_cover(Path(album_path), cover_data)
                emit_task_event(
                    task_id,
                    "cover_applied",
                    {
                        "message": f"Cover applied: {artist} / {album_name}",
                        "artist": artist,
                        "album": album_name,
                        "source": source,
                    },
                )
        else:
            not_found += 1
            emit_task_event(
                task_id,
                "info",
                {
                    "message": f"No cover found for {artist} / {album_name}",
                    "artist": artist,
                    "album": album_name,
                },
            )

        time.sleep(0.3)

    return {"total_missing": len(missing), "found": found, "not_found": not_found}


def _handle_apply_cover(task_id: str, params: dict, config: dict) -> dict:
    """Apply a found cover to an album."""
    from crate.artwork import fetch_cover_from_caa, save_cover

    album_path = params.get("path", "")
    source = params.get("source", "")
    mbid = params.get("mbid", "")

    if not album_path:
        return {"error": "No album path"}

    album_dir = Path(album_path)
    if not album_dir.is_dir():
        return {"error": "Album directory not found"}

    cover_data = None

    if source == "coverartarchive" and mbid:
        cover_data = fetch_cover_from_caa(mbid)
    elif source == "deezer":
        artist = params.get("artist", "")
        album = params.get("album", "")
        try:
            import requests as _requests

            resp = _requests.get(
                "https://api.deezer.com/search/album",
                params={"q": f"{artist} {album}", "limit": 1},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                if data and data[0].get("cover_xl"):
                    img_resp = _requests.get(data[0]["cover_xl"], timeout=10)
                    if img_resp.status_code == 200:
                        cover_data = img_resp.content
        except Exception:
            log.debug(
                "Failed to fetch Deezer cover for %s / %s", artist, album, exc_info=True
            )

    if not cover_data:
        return {"error": "Failed to fetch cover"}

    save_cover(album_dir, cover_data)
    emit_task_event(
        task_id,
        "cover_applied",
        {
            "message": f"Cover applied: {params.get('artist')} / {params.get('album')}",
            "artist": params.get("artist"),
            "album": params.get("album"),
        },
    )

    return {"applied": True, "path": album_path}


def _handle_upload_image(task_id: str, params: dict, config: dict) -> dict:
    """Save uploaded image to the correct location in the library."""
    from PIL import Image

    img_type = params.get("type")
    artist = params.get("artist", "")
    album = params.get("album", "")
    release_id = params.get("release_id")
    data_b64 = params.get("data_b64", "")

    if not data_b64:
        return {"error": "No image data"}

    raw = base64.b64decode(data_b64)
    img = Image.open(_io.BytesIO(raw)).convert("RGB")
    lib = Path(config["library_path"]).resolve()

    def _safe_dest(path: Path) -> Path:
        resolved = path.resolve()
        if not resolved.is_relative_to(lib):
            raise ValueError(f"Path traversal blocked: {resolved} is outside {lib}")
        return resolved

    invalidation_scopes: list[str] = []
    materialization_asset: ArtworkAsset | None = None

    if img_type == "cover":
        album_data = get_library_album(artist, album)
        if not album_data:
            return {"error": "Album not found"}
        dest = _safe_dest(Path(album_data["path"]) / "cover.jpg")
        img.save(str(dest), "JPEG", quality=92)
        if album_data.get("id"):
            set_album_has_cover(int(album_data["id"]))
            invalidation_scopes.append(f"album:{album_data['id']}")
        if album_data.get("entity_uid"):
            materialization_asset = ArtworkAsset(
                "album-cover", str(album_data["entity_uid"])
            )
        invalidation_scopes.extend(["library", "home"])
    elif img_type == "release_cover":
        if not release_id:
            return {"error": "Release not found"}
        dest = release_cover_abspath(int(release_id))
        img.save(str(dest), "JPEG", quality=92)
        if not update_new_release_cover(
            int(release_id),
            cover_url=release_cover_public_url(int(release_id)),
            cover_source="manual",
        ):
            return {"error": "Release not found"}
        materialization_asset = ArtworkAsset("release-cover", str(int(release_id)))
        invalidation_scopes.extend(["library", "home", "upcoming"])
    elif img_type == "artist_photo":
        artist_row = get_library_artist(artist)
        found_dir = resolve_artist_dir(
            lib, artist_row, fallback_name=artist, existing_only=True
        )
        if not found_dir or not found_dir.is_dir():
            return {"error": "Artist directory not found"}
        dest = _safe_dest(found_dir / "artist.jpg")
        img.save(str(dest), "JPEG", quality=92)
        set_artist_has_photo(artist)
        if artist_row and artist_row.get("id"):
            invalidation_scopes.append(f"artist:{artist_row['id']}")
        if artist_row and artist_row.get("entity_uid"):
            materialization_asset = ArtworkAsset(
                "artist-photo", str(artist_row["entity_uid"])
            )
        invalidation_scopes.extend(["library", "home", "shows", "upcoming"])
    elif img_type == "background":
        artist_row = get_library_artist(artist)
        found_dir = resolve_artist_dir(
            lib, artist_row, fallback_name=artist, existing_only=True
        )
        if not found_dir or not found_dir.is_dir():
            return {"error": "Artist directory not found"}
        dest = _safe_dest(found_dir / "background.jpg")
        img.save(str(dest), "JPEG", quality=90)
        touch_artist_artwork(artist)
        if artist_row and artist_row.get("id"):
            invalidation_scopes.append(f"artist:{artist_row['id']}")
        if artist_row and artist_row.get("entity_uid"):
            materialization_asset = ArtworkAsset(
                "artist-background", str(artist_row["entity_uid"])
            )
        invalidation_scopes.extend(["library", "home", "shows", "upcoming"])
    elif img_type == "genre_cover":
        from crate.db.repositories.genres_taxonomy_metadata import (
            update_genre_taxonomy_node_metadata,
        )
        from crate.genre_covers import persist_genre_cover_upload

        slug = str(params.get("slug") or "").strip().lower()
        if not slug:
            return {"error": "Genre slug is required"}
        try:
            cover_path = persist_genre_cover_upload(
                slug,
                filename=str(params.get("filename") or ""),
                content_type=params.get("content_type"),
                payload=raw,
            )
        except ValueError as exc:
            return {"error": str(exc)}
        if not update_genre_taxonomy_node_metadata(slug, cover_path=cover_path):
            return {"error": "Genre not found"}
        dest = Path(cover_path)
        materialization_asset = ArtworkAsset("genre-cover", slug)
        invalidation_scopes.extend(["library", "home", f"genre:{slug}"])
    else:
        return {"error": f"Unknown image type: {img_type}"}

    log.info(
        "Image uploaded: %s for %s (%dx%d)", img_type, artist, img.width, img.height
    )

    if materialization_asset is not None:
        queue_artwork_materialization(materialization_asset, reason="source-write")

    if img_type == "cover":
        try:
            start_scan()
        except Exception:
            log.debug("Failed to start library scan after cover upload", exc_info=True)

    try:
        import requests as _req

        _req.post(
            "http://crate-api:8585/api/cache/invalidate",
            json={"scopes": list(dict.fromkeys(invalidation_scopes))},
            timeout=3,
        )
    except Exception:
        log.debug("Failed to broadcast artwork cache invalidation", exc_info=True)

    return {
        "type": img_type,
        "path": str(dest),
        "width": img.width,
        "height": img.height,
    }


def _handle_fetch_album_cover(task_id: str, params: dict, config: dict) -> dict:
    """Search all sources for a cover for a specific album."""
    from crate.artwork import extract_embedded_cover, fetch_cover_from_caa, save_cover

    artist = params.get("artist", "")
    album = params.get("album", "")
    path = params.get("path", "")
    mbid = params.get("mbid", "")
    album_id = params.get("album_id")

    album_dir = Path(path) if path else None
    if not album_dir or not album_dir.is_dir():
        return {"error": "Album directory not found"}

    if any((album_dir / c).exists() for c in ("cover.jpg", "cover.png", "folder.jpg")):
        return {"status": "already_has_cover"}

    cover_data = None
    source = None

    # 1. CoverArtArchive (MBID)
    if mbid and mbid.strip():
        cover_data = fetch_cover_from_caa(mbid)
        if cover_data:
            source = "coverartarchive"

    # 2. Embedded in audio files
    if not cover_data:
        audio_files = list(album_dir.glob("*.flac")) + list(album_dir.glob("*.mp3"))
        for audio_file in audio_files[:1]:
            embedded = extract_embedded_cover(audio_file)
            if embedded:
                cover_data = embedded
                source = "embedded"
                break

    # 3. Deezer
    if not cover_data:
        cover_data = _fetch_deezer_cover(artist, album)
        if cover_data:
            source = "deezer"

    # 4. iTunes
    if not cover_data:
        cover_data = _fetch_itunes_cover(artist, album)
        if cover_data:
            source = "itunes"

    # 5. Last.fm
    if not cover_data:
        cover_data = _fetch_lastfm_cover(artist, album)
        if cover_data:
            source = "lastfm"

    # 6. MusicBrainz search (if no MBID)
    if not cover_data and not (mbid and mbid.strip()):
        cover_data = _search_musicbrainz_cover(artist, album)
        if cover_data:
            source = "musicbrainz"

    if cover_data:
        save_cover(album_dir, cover_data)
        if album_id:
            set_album_has_cover(album_id)
            album_row = get_library_album_by_id(int(album_id))
            if album_row and album_row.get("entity_uid"):
                queue_artwork_materialization(
                    ArtworkAsset("album-cover", str(album_row["entity_uid"])),
                    reason="source-write",
                )
        emit_task_event(
            task_id,
            "cover_applied",
            {
                "message": f"Cover found for {artist} / {album} ({source})",
                "source": source,
            },
        )
        return {"status": "found", "source": source}

    return {
        "status": "not_found",
        "sources_tried": [
            "coverartarchive",
            "embedded",
            "deezer",
            "itunes",
            "lastfm",
            "musicbrainz",
        ],
    }


ARTWORK_TASK_HANDLERS: dict[str, TaskHandler] = {
    "materialize_artwork_variants": _handle_materialize_artwork_variants,
    "backfill_artwork_variants": _handle_backfill_artwork_variants,
    "cleanup_artwork_variants": _handle_cleanup_artwork_variants,
    "repair_artwork_variants": _handle_repair_artwork_variants,
    "resolve_external_artist_artwork": _handle_resolve_external_artist_artwork,
    "fetch_cover": _handle_fetch_cover,
    "fetch_album_cover": _handle_fetch_album_cover,
    "fetch_artist_covers": _handle_fetch_artist_covers,
    "fetch_artwork_all": _handle_fetch_artwork_all,
    "batch_covers": _handle_batch_covers,
    "scan_missing_covers": _handle_scan_missing_covers,
    "apply_cover": _handle_apply_cover,
    "upload_image": _handle_upload_image,
}
