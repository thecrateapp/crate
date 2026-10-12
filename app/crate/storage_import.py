from __future__ import annotations

import logging
import re
import shutil
import uuid
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from crate.audio import audio_format_rank, read_audio_quality, read_tags
from crate.db.repositories.library import (
    get_library_album,
    get_library_artist,
    upsert_artist,
)
from crate.entity_ids import album_entity_uid, artist_entity_uid, track_entity_uid
from crate.storage_layout import album_dir as managed_album_dir
from crate.storage_layout import entity_uid_for, looks_like_entity_uid

log = logging.getLogger(__name__)

SAME_TRACK_MAX_DURATION_DELTA_SEC = 2.0

DEFAULT_AUDIO_EXTENSIONS = {
    ".flac",
    ".mp3",
    ".m4a",
    ".ogg",
    ".opus",
    ".wav",
    ".aac",
    ".alac",
}


def _normalize_segment_key(name: str) -> str:
    return re.sub(r"^[.\s]+", "", (name or "").strip()).casefold()


def sanitize_segment(name: str, fallback: str = "Unknown") -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", (name or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^[.\s]+", "", cleaned)
    cleaned = cleaned.rstrip(" .")
    return cleaned or fallback


def resolve_child_dir_name(
    parent: Path, raw_name: str, fallback: str = "Unknown"
) -> str:
    safe_name = sanitize_segment(raw_name, fallback=fallback)
    if not parent.exists():
        return safe_name
    existing_dirs = [d.name for d in parent.iterdir() if d.is_dir()]
    normalized_matches = [
        name
        for name in existing_dirs
        if _normalize_segment_key(name) == _normalize_segment_key(raw_name)
    ]
    visible_matches = [name for name in normalized_matches if not name.startswith(".")]
    if visible_matches:
        return visible_matches[0]
    if normalized_matches:
        return normalized_matches[0]
    return safe_name


def iter_audio_files_recursive(
    root: Path, extensions: set[str] | None = None
) -> list[Path]:
    allowed = {ext.lower() for ext in (extensions or DEFAULT_AUDIO_EXTENSIONS)}
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in allowed
    )


def infer_album_identity(
    staged_album_dir: Path, fallback_artist: str = ""
) -> tuple[str, str]:
    tracks = iter_audio_files_recursive(staged_album_dir)
    if tracks:
        tags = read_tags(tracks[0])
        artist_name = (
            tags.get("albumartist")
            or tags.get("artist")
            or fallback_artist
            or staged_album_dir.parent.name
        ).strip()
        album_name = (
            tags.get("album") or staged_album_dir.name or "Unknown Album"
        ).strip()
        return (
            artist_name or fallback_artist or "Unknown Artist",
            album_name or "Unknown Album",
        )
    return (
        fallback_artist or staged_album_dir.parent.name or "Unknown Artist",
        staged_album_dir.name or "Unknown Album",
    )


def _parse_tag_integer(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    match = re.match(r"^(\d+)", text)
    return int(match.group(1)) if match else None


def ensure_import_artist(artist_name: str) -> dict:
    artist = get_library_artist(artist_name)
    if artist:
        return dict(artist)

    entity_uid = str(artist_entity_uid(name=artist_name))
    upsert_artist(
        {
            "name": artist_name,
            "entity_uid": entity_uid,
            "folder_name": entity_uid,
            "album_count": 0,
            "track_count": 0,
            "total_size": 0,
            "formats": [],
            "dir_mtime": None,
        }
    )
    created = get_library_artist(artist_name)
    return (
        dict(created)
        if created
        else {
            "name": artist_name,
            "entity_uid": entity_uid,
            "folder_name": entity_uid,
        }
    )


def resolve_import_album_target(
    library_root: str | Path, artist_name: str, album_name: str
) -> tuple[dict, Path, bool]:
    root = Path(library_root)
    artist = ensure_import_artist(artist_name)

    folder_name = str(artist.get("folder_name") or "")
    stored_artist_uid = entity_uid_for(artist, "entity_uid")
    artist_uid = str(stored_artist_uid or artist_entity_uid(name=artist["name"]))
    is_managed_artist = bool(stored_artist_uid) or looks_like_entity_uid(folder_name)

    # For managed artists, always use V2 layout
    if is_managed_artist and artist_uid:
        existing_album = get_library_album(artist["name"], album_name)
        if existing_album and existing_album.get("path"):
            existing_path = Path(existing_album["path"])
            # Only reuse existing path if it's already V2
            if looks_like_entity_uid(existing_path.name):
                return artist, existing_path, True
        # New album or legacy path — create V2 target
        existing_album_uid = (
            entity_uid_for(existing_album, "entity_uid") if existing_album else None
        )
        album_uid = str(
            existing_album_uid
            if existing_album_uid
            else album_entity_uid(
                artist_name=artist["name"],
                artist_uid=artist_uid,
                album_name=album_name,
            )
        )
        target = managed_album_dir(root, artist_uid, album_uid)
        return artist, target, True

    # Legacy artist — use name-based paths
    existing_album = get_library_album(artist["name"], album_name)
    if existing_album and existing_album.get("path"):
        target = Path(existing_album["path"])
        return artist, target, looks_like_entity_uid(target.name)

    artist_root = root / (
        folder_name or sanitize_segment(artist["name"], fallback="Unknown Artist")
    )
    album_folder = resolve_child_dir_name(
        artist_root, album_name, fallback="Unknown Album"
    )
    return artist, artist_root / album_folder, False


def move_file(src: Path, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        if dest.is_dir():
            shutil.rmtree(dest, ignore_errors=True)
        else:
            dest.unlink()
    shutil.move(str(src), str(dest))


def _track_identity(tags: dict) -> tuple[int, int, str] | None:
    track_number = _parse_tag_integer(tags.get("tracknumber"))
    title = " ".join(str(tags.get("title") or "").split()).casefold()
    if not track_number or not title:
        return None
    return (_parse_tag_integer(tags.get("discnumber")) or 1, track_number, title)


@lru_cache(maxsize=8192)
def _cached_track_identity(
    path: str, _mtime_ns: int, _size: int
) -> tuple[int, int, str] | None:
    return _track_identity(read_tags(Path(path)))


def _find_existing_copy(
    target_album_dir: Path, identity: tuple[int, int, str], exclude: Path
) -> Path | None:
    if not target_album_dir.is_dir():
        return None
    for candidate in sorted(target_album_dir.iterdir()):
        if (
            candidate == exclude
            or not candidate.is_file()
            or candidate.suffix.lower() not in DEFAULT_AUDIO_EXTENSIONS
        ):
            continue
        stat = candidate.stat()
        if _cached_track_identity(str(candidate), stat.st_mtime_ns, stat.st_size) == (
            identity
        ):
            return candidate
    return None


def _audio_quality_key(path: Path, quality: dict) -> tuple[int, int, int, int]:
    return (
        audio_format_rank(path.suffix),
        int(quality.get("bit_depth") or 0),
        int(quality.get("sample_rate") or 0),
        int(quality.get("bitrate") or 0),
    )


def _quarantine_replaced_copy(existing: Path, library_root: Path) -> Path:
    destination = (
        library_root / ".crate-trash" / "tracks" / existing.relative_to(library_root)
    )
    if destination.exists():
        destination = destination.with_name(
            f"{destination.stem}.{uuid.uuid4().hex[:8]}{destination.suffix}"
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(existing), str(destination))
    log.info("Quarantined replaced copy %s -> %s", existing, destination)
    return destination


@dataclass(frozen=True)
class ManagedTrackPlacement:
    dest: Path
    replaces: Path | None = None


def resolve_managed_track_destination(
    src: Path,
    target_album_dir: Path,
    *,
    artist_name: str,
    album_name: str,
    album_entity_uid: str,
    replace_existing_audio: bool = False,
) -> ManagedTrackPlacement | None:
    """Decide where ``src`` lands in a managed album without touching the disk.

    Returns ``None`` when the album already holds an equal or better copy of the
    same track. When ``src`` replaces a worse copy it takes that copy's file stem
    so the library row (and everything pointing at it) survives the swap."""
    tags = read_tags(src)
    track_uid = track_entity_uid(
        album_uid=album_entity_uid,
        artist_name=(tags.get("artist") or artist_name or "").strip(),
        album_name=(tags.get("album") or album_name or "").strip(),
        title=(tags.get("title") or src.stem or "").strip(),
        filename=src.name,
        disc_number=_parse_tag_integer(tags.get("discnumber")),
        track_number=_parse_tag_integer(tags.get("tracknumber")),
        musicbrainz_trackid=tags.get("musicbrainz_trackid"),
        musicbrainz_albumid=tags.get("musicbrainz_albumid"),
    )
    dest = target_album_dir / f"{track_uid}{src.suffix.lower()}"

    identity = _track_identity(tags)
    existing = (
        _find_existing_copy(target_album_dir, identity, exclude=src)
        if identity
        else None
    )
    if existing is not None:
        new_quality = read_audio_quality(src)
        existing_quality = read_audio_quality(existing)
        new_duration = float(new_quality.get("duration") or 0)
        existing_duration = float(existing_quality.get("duration") or 0)
        if (
            new_duration
            and existing_duration
            and abs(new_duration - existing_duration)
            <= SAME_TRACK_MAX_DURATION_DELTA_SEC
        ):
            if not replace_existing_audio and _audio_quality_key(
                src, new_quality
            ) <= _audio_quality_key(existing, existing_quality):
                log.info("Skipping %s: %s is an equal or better copy", src, existing)
                return None
            return ManagedTrackPlacement(
                dest=existing.with_suffix(src.suffix.lower()), replaces=existing
            )

    if dest.exists() and not replace_existing_audio:
        collision_uid = uuid.uuid5(
            track_uid, f"collision:{src.name.lower()}:{src.stat().st_size}"
        )
        dest = target_album_dir / f"{collision_uid}{src.suffix.lower()}"
    return ManagedTrackPlacement(dest=dest)


def install_managed_track(
    src: Path,
    placement: ManagedTrackPlacement,
    *,
    library_root: str | Path,
    copy: bool = False,
) -> None:
    """Put ``src`` in place first and only then retire the copy it replaces, so a
    failed write never leaves the library without the track."""
    root = Path(library_root)
    dest = placement.dest
    parked = _quarantine_replaced_copy(dest, root) if dest.exists() else None
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if copy:
            shutil.copy2(str(src), str(dest))
        else:
            shutil.move(str(src), str(dest))
    except Exception:
        dest.unlink(missing_ok=True)
        if parked is not None:
            shutil.move(str(parked), str(dest))
        raise
    replaced = placement.replaces
    if replaced is not None and replaced != dest and replaced.exists():
        _quarantine_replaced_copy(replaced, root)


def move_album_tree(
    staged_album_dir: Path,
    target_album_dir: Path,
    *,
    managed_track_names: bool,
    artist_name: str,
    album_name: str,
    replace_existing_audio: bool = False,
    library_root: str | Path | None = None,
) -> int:
    moved = 0
    if managed_track_names:
        root = Path(library_root) if library_root else target_album_dir.parent.parent
        target_album_dir.mkdir(parents=True, exist_ok=True)
        album_entity_uid = target_album_dir.name
        for src in sorted(staged_album_dir.rglob("*")):
            if not src.is_file():
                continue
            is_audio = src.suffix.lower() in DEFAULT_AUDIO_EXTENSIONS
            placement = (
                resolve_managed_track_destination(
                    src,
                    target_album_dir,
                    artist_name=artist_name,
                    album_name=album_name,
                    album_entity_uid=album_entity_uid,
                    replace_existing_audio=replace_existing_audio,
                )
                if is_audio
                else None
            )
            if is_audio and placement is None:
                continue
            try:
                if placement is None:
                    move_file(src, target_album_dir / src.name)
                else:
                    install_managed_track(src, placement, library_root=root)
                moved += 1
            except Exception:
                log.warning(
                    "Failed to move %s into %s", src, target_album_dir, exc_info=True
                )
        shutil.rmtree(staged_album_dir, ignore_errors=True)
        return moved

    target_album_dir.mkdir(parents=True, exist_ok=True)
    for src in sorted(staged_album_dir.rglob("*")):
        if not src.is_file():
            continue
        relative = src.relative_to(staged_album_dir)
        dest = target_album_dir / relative
        try:
            move_file(src, dest)
            moved += 1
        except Exception:
            log.warning("Failed to move %s -> %s", src, dest, exc_info=True)
    shutil.rmtree(staged_album_dir, ignore_errors=True)
    return moved
