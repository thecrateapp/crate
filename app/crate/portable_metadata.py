from __future__ import annotations

import json
import hashlib
import os
import re
import shutil
import stat
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any


PORTABLE_SCHEMA_VERSION = 1
TAG_SCHEMA_VERSION = "1"
_ARTWORK_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
_ARTWORK_NAMES = {"cover", "folder", "front", "album", "artwork"}
MAX_SIDECAR_BYTES = 16 * 1024 * 1024
MAX_SIDECAR_TRACKS = 10000


def _safe_relative(value: Any) -> Path:
    raw = str(value or "")
    path = Path(raw)
    if (
        not raw
        or "\\" in raw
        or "\x00" in raw
        or path.is_absolute()
        or ".." in path.parts
    ):
        raise ValueError("Metadata path must stay inside its album")
    if not path.parts or path == Path("."):
        raise ValueError("Metadata path is empty")
    return path


def _album_root(value: str | Path) -> Path:
    root = Path(value).absolute()
    current = Path(root.anchor)
    for part in root.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise ValueError("Symlink album directory components are not supported")
    return root


def _contained_path(root: Path, relative: str | Path) -> Path:
    relative = _safe_relative(relative)
    candidate = root / relative
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Symlink metadata paths are not supported")
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise ValueError("Metadata path is outside its album")
    return candidate


def _track_relative(track: dict[str, Any], album_dir: Path) -> Path:
    relative = track.get("relative_path") or track.get("filename")
    path = track.get("path")
    if path:
        source = Path(str(path)).absolute()
        try:
            actual_relative = source.relative_to(album_dir)
        except ValueError:
            raise ValueError("Track source is outside its album") from None
        _contained_path(album_dir, actual_relative)
        if not relative:
            relative = str(actual_relative)
    return _safe_relative(relative)


def _copy_regular_file(source: Path, target: Path) -> None:
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(source_fd, "rb") as reader:
        if not stat.S_ISREG(os.fstat(reader.fileno()).st_mode):
            raise ValueError("Metadata source is not a regular file")
        target_fd = os.open(
            target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
        with os.fdopen(target_fd, "wb") as writer:
            shutil.copyfileobj(reader, writer)


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _tag_value(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _identity_tags(
    *,
    artist_uid: Any,
    album_uid: Any,
    track_uid: Any,
    audio_fingerprint: Any = None,
    audio_fingerprint_source: Any = None,
) -> dict[str, str]:
    raw = {
        "crate_schema_version": TAG_SCHEMA_VERSION,
        "crate_artist_uid": artist_uid,
        "crate_album_uid": album_uid,
        "crate_track_uid": track_uid,
        "crate_audio_fingerprint": audio_fingerprint,
        "crate_audio_fingerprint_source": audio_fingerprint_source,
    }
    return {
        key: text
        for key, value in raw.items()
        if (text := _tag_value(value)) is not None
    }


def _find_artwork_files(album_dir: Path) -> list[str]:
    if not album_dir.is_dir():
        return []
    matches: list[str] = []
    for child in album_dir.iterdir():
        if (
            child.is_symlink()
            or not child.is_file()
            or child.suffix.lower() not in _ARTWORK_EXTENSIONS
        ):
            continue
        stem = child.stem.lower().strip()
        if stem in _ARTWORK_NAMES or stem.startswith("cover"):
            matches.append(child.name)
    return sorted(matches)


def _sidecar_payload(album_payload: dict[str, Any], album_dir: Path) -> dict[str, Any]:
    payload = {
        key: value for key, value in album_payload.items() if not key.startswith("_")
    }
    album = dict(payload.get("album") or {})
    album["artwork_files"] = _find_artwork_files(album_dir)
    payload["album"] = album
    tracks = payload.get("tracks") or []
    if not isinstance(tracks, list) or len(tracks) > MAX_SIDECAR_TRACKS:
        raise ValueError("Invalid portable track list")
    payload["tracks"] = [
        {**track, "relative_path": str(_track_relative(track, album_dir))}
        for track in tracks
    ]
    payload["schema_version"] = PORTABLE_SCHEMA_VERSION
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    return payload


def write_album_sidecar(album_payload: dict[str, Any]) -> Path:
    album = album_payload.get("album") or {}
    album_path = album.get("path")
    if not album_path:
        raise ValueError("album payload does not include a path")

    album_dir = _album_root(str(album_path))
    if not album_dir.is_dir():
        raise ValueError("Album directory is unavailable")
    _contained_path(album_dir, ".crate/album.json")
    sidecar_dir = album_dir / ".crate"
    sidecar_dir.mkdir(parents=True, exist_ok=True)
    sidecar_path = sidecar_dir / "album.json"
    payload = _sidecar_payload(album_payload, album_dir)
    serialized = (
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            default=_json_default,
            allow_nan=False,
        )
        + "\n"
    )
    if len(serialized.encode("utf-8")) > MAX_SIDECAR_BYTES:
        raise ValueError("Portable sidecar exceeds the size limit")

    fd, tmp_name = tempfile.mkstemp(
        prefix="album.", suffix=".json.tmp", dir=sidecar_dir
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(serialized)
        tmp_path.replace(sidecar_path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise
    return sidecar_path


def _write_mp4_tags(path: Path, tags: dict[str, str]) -> None:
    from mutagen.mp4 import MP4, MP4FreeForm

    try:
        from mutagen.mp4 import AtomDataType

        dataformat = AtomDataType.UTF8
    except Exception:
        dataformat = 1

    audio = MP4(str(path))
    for key, value in tags.items():
        if key == "lyrics":
            audio["\xa9lyr"] = [value]
            continue
        audio[f"----:com.crate:{key}"] = [
            MP4FreeForm(value.encode("utf-8"), dataformat=dataformat)
        ]
    audio.save()


def _write_mp3_tags(path: Path, tags: dict[str, str]) -> None:
    import mutagen.id3 as id3
    from mutagen.mp3 import MP3

    TXXX = getattr(id3, "TXXX")
    USLT = getattr(id3, "USLT")
    audio = MP3(str(path))
    if audio.tags is None:
        audio.add_tags()
    tags_obj = audio.tags
    if tags_obj is None:
        raise ValueError("could not initialize MP3 tags")
    for key, value in tags.items():
        if key == "lyrics":
            tags_obj.delall("USLT")
            tags_obj.add(USLT(encoding=3, lang="eng", desc="", text=value))
            continue
        tags_obj.delall(f"TXXX:{key}")
        tags_obj.add(TXXX(encoding=3, desc=key, text=[value]))
    audio.save()


def _write_mapping_tags(path: Path, tags: dict[str, str]) -> None:
    import mutagen

    audio = getattr(mutagen, "File")(str(path))
    if audio is None:
        raise ValueError("unsupported audio file")
    for key, value in tags.items():
        audio[key] = value
    audio.save()


def _write_tags_for_path(path: Path, tags: dict[str, str]) -> None:
    suffix = path.suffix.lower()
    if suffix in {".m4a", ".mp4", ".aac", ".alac"}:
        _write_mp4_tags(path, tags)
    elif suffix == ".mp3":
        _write_mp3_tags(path, tags)
    else:
        _write_mapping_tags(path, tags)


def _image_mime(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "image/jpeg"


def find_album_artwork_file(
    album_dir: str | Path, names: list[str] | None = None
) -> Path | None:
    root = _album_root(str(album_dir))
    if not root.is_dir():
        return None
    candidates = names or _find_artwork_files(root)
    for name in candidates:
        path = _contained_path(root, name)
        if path.is_file() and path.suffix.lower() in _ARTWORK_EXTENSIONS:
            return path
    return None


def _embed_mp4_artwork(path: Path, artwork_path: Path) -> None:
    from mutagen.mp4 import MP4, MP4Cover

    audio = MP4(str(path))
    suffix = artwork_path.suffix.lower()
    if suffix == ".png":
        image_data = artwork_path.read_bytes()
        image_format = MP4Cover.FORMAT_PNG
    elif suffix in {".jpg", ".jpeg"}:
        image_data = artwork_path.read_bytes()
        image_format = MP4Cover.FORMAT_JPEG
    else:
        from PIL import Image

        with Image.open(artwork_path) as image:
            if image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")
            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=92)
        image_data = buffer.getvalue()
        image_format = MP4Cover.FORMAT_JPEG
    audio["covr"] = [MP4Cover(image_data, imageformat=image_format)]
    audio.save()


def _embed_mp3_artwork(path: Path, artwork_path: Path) -> None:
    import mutagen.id3 as id3
    from mutagen.mp3 import MP3

    APIC = getattr(id3, "APIC")
    audio = MP3(str(path))
    if audio.tags is None:
        audio.add_tags()
    tags_obj = audio.tags
    if tags_obj is None:
        raise ValueError("could not initialize MP3 tags")
    tags_obj.delall("APIC")
    tags_obj.add(
        APIC(
            encoding=3,
            mime=_image_mime(artwork_path),
            type=3,
            desc="Cover",
            data=artwork_path.read_bytes(),
        )
    )
    audio.save()


def _embed_flac_artwork(path: Path, artwork_path: Path) -> None:
    from mutagen.flac import FLAC, Picture

    audio = FLAC(str(path))
    picture = Picture()
    picture.type = 3
    picture.mime = _image_mime(artwork_path)
    picture.desc = "Cover"
    picture.data = artwork_path.read_bytes()
    audio.clear_pictures()
    audio.add_picture(picture)
    audio.save()


def _embed_artwork_for_path(path: Path, artwork_path: str | Path | None) -> bool:
    if not artwork_path:
        return False
    artwork = Path(str(artwork_path))
    if not artwork.is_file():
        return False
    suffix = path.suffix.lower()
    if suffix in {".m4a", ".mp4", ".aac", ".alac"}:
        _embed_mp4_artwork(path, artwork)
        return True
    elif suffix == ".mp3":
        _embed_mp3_artwork(path, artwork)
        return True
    elif suffix == ".flac":
        _embed_flac_artwork(path, artwork)
        return True
    return False


def write_track_identity_tags(
    track_path: str | Path,
    *,
    artist_uid: Any,
    album_uid: Any,
    track_uid: Any,
    audio_fingerprint: Any = None,
    audio_fingerprint_source: Any = None,
) -> dict[str, Any]:
    path = Path(str(track_path))
    if path.is_symlink():
        raise ValueError("Symlink audio files are not supported")
    if not path.exists():
        return {"written": False, "path": str(path), "error": "file not found"}

    tags = _identity_tags(
        artist_uid=artist_uid,
        album_uid=album_uid,
        track_uid=track_uid,
        audio_fingerprint=audio_fingerprint,
        audio_fingerprint_source=audio_fingerprint_source,
    )
    if not tags:
        return {
            "written": False,
            "path": str(path),
            "error": "no identity tags to write",
        }

    try:
        _write_tags_for_path(path, tags)
    except Exception as exc:
        return {"written": False, "path": str(path), "error": str(exc)[:500]}
    return {"written": True, "path": str(path), "tags": sorted(tags)}


def _rich_tags(
    *,
    artist_uid: Any,
    album_uid: Any,
    track_payload: dict[str, Any],
) -> dict[str, str]:
    tags = _identity_tags(
        artist_uid=artist_uid,
        album_uid=album_uid,
        track_uid=track_payload.get("entity_uid"),
        audio_fingerprint=track_payload.get("audio_fingerprint"),
        audio_fingerprint_source=track_payload.get("audio_fingerprint_source"),
    )
    lyrics = track_payload.get("lyrics") or {}
    analysis = track_payload.get("analysis") or {}
    bliss = track_payload.get("bliss") or {}
    extras = {
        "crate_plain_lyrics": lyrics.get("plain"),
        "crate_synced_lyrics": lyrics.get("synced"),
        "lyrics": lyrics.get("plain"),
        "unsyncedlyrics": lyrics.get("plain"),
        "syncedlyrics": lyrics.get("synced"),
        "crate_analysis_json": json.dumps(
            analysis, ensure_ascii=False, sort_keys=True, default=_json_default
        )
        if analysis
        else None,
        "crate_bliss_vector": ",".join(
            str(value) for value in (bliss.get("vector") or [])
        )
        if bliss.get("vector")
        else None,
    }
    tags.update(
        {
            key: text
            for key, value in extras.items()
            if (text := _tag_value(value)) is not None
        }
    )
    return tags


def write_track_rich_tags(
    track_path: str | Path,
    *,
    artist_uid: Any,
    album_uid: Any,
    track_payload: dict[str, Any],
    artwork_path: str | Path | None = None,
) -> dict[str, Any]:
    path = Path(str(track_path))
    if path.is_symlink():
        raise ValueError("Symlink audio files are not supported")
    if not path.exists():
        return {"written": False, "path": str(path), "error": "file not found"}

    tags = _rich_tags(
        artist_uid=artist_uid, album_uid=album_uid, track_payload=track_payload
    )
    if not tags:
        return {"written": False, "path": str(path), "error": "no tags to write"}

    try:
        _write_tags_for_path(path, tags)
        artwork_embedded = False
        artwork_error = None
        if artwork_path:
            try:
                artwork_embedded = _embed_artwork_for_path(path, artwork_path)
            except Exception as exc:
                artwork_error = str(exc)[:500]
    except Exception as exc:
        return {"written": False, "path": str(path), "error": str(exc)[:500]}
    result = {
        "written": True,
        "path": str(path),
        "tags": sorted(tags),
        "artwork_embedded": artwork_embedded,
    }
    if artwork_error:
        result["artwork_error"] = artwork_error
    return result


def write_album_portable_metadata(
    album_payload: dict[str, Any],
    *,
    write_audio_tags: bool = True,
    write_sidecars: bool = True,
) -> dict[str, Any]:
    album_path = (album_payload.get("album") or {}).get("path")
    if not album_path:
        raise ValueError("Album path is required")
    album_dir = _album_root(str(album_path))
    for track in album_payload.get("tracks") or []:
        _contained_path(album_dir, _track_relative(track, album_dir))
    artist_uid = (album_payload.get("artist") or {}).get("entity_uid")
    album_uid = (album_payload.get("album") or {}).get("entity_uid")
    result: dict[str, Any] = {
        "album_id": (album_payload.get("album") or {}).get("id"),
        "album_entity_uid": album_uid,
        "sidecar_path": None,
        "tracks": 0,
        "tags_written": 0,
        "tag_errors": [],
    }

    if write_sidecars:
        result["sidecar_path"] = str(write_album_sidecar(album_payload))

    if not write_audio_tags:
        result["tracks"] = len(album_payload.get("tracks") or [])
        return result

    for track in album_payload.get("tracks") or []:
        result["tracks"] += 1
        tag_result = write_track_identity_tags(
            track.get("path"),
            artist_uid=artist_uid,
            album_uid=album_uid,
            track_uid=track.get("entity_uid"),
            audio_fingerprint=track.get("audio_fingerprint"),
            audio_fingerprint_source=track.get("audio_fingerprint_source"),
        )
        if tag_result.get("written"):
            result["tags_written"] += 1
        elif tag_result.get("error"):
            result["tag_errors"].append(tag_result)

    return result


def iter_album_sidecars(
    root_path: str | Path, *, limit: int | None = None
) -> list[Path]:
    root = _album_root(str(root_path))
    if not root.exists():
        return []
    sidecars: list[Path] = []
    for candidate in root.rglob("album.json"):
        if candidate.parent.name != ".crate":
            continue
        _contained_path(root, candidate.relative_to(root))
        sidecars.append(candidate)
        if limit is not None and len(sidecars) >= limit:
            break
    return sorted(sidecars)


def load_album_sidecar(sidecar_path: str | Path) -> dict[str, Any]:
    path = Path(str(sidecar_path))
    album_dir = _album_root(path.parent.parent)
    path = _contained_path(album_dir, path.absolute().relative_to(album_dir))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise ValueError("Portable sidecar is not a regular file")
        raw = handle.read(MAX_SIDECAR_BYTES + 1)
    if len(raw) > MAX_SIDECAR_BYTES:
        raise ValueError("Portable sidecar exceeds the size limit")

    def reject_constant(value):
        raise ValueError("Non-finite values are not valid portable metadata")

    payload = json.loads(raw, parse_constant=reject_constant)
    if (
        not isinstance(payload, dict)
        or type(payload.get("schema_version")) is not int
        or payload.get("schema_version") != PORTABLE_SCHEMA_VERSION
    ):
        raise ValueError("Unsupported portable metadata schema")
    if not isinstance(payload.get("album"), dict) or not isinstance(
        payload.get("artist", {}), dict
    ):
        raise ValueError("Invalid portable album metadata")
    source_tracks = payload.get("tracks")
    if not isinstance(source_tracks, list) or len(source_tracks) > MAX_SIDECAR_TRACKS:
        raise ValueError("Invalid portable track list")
    album = dict(payload.get("album") or {})
    album["path"] = str(album_dir)
    payload["album"] = album
    payload["_sidecar_path"] = str(path)
    payload["_sidecar_sha256"] = hashlib.sha256(raw).hexdigest()

    tracks = []
    for track_payload in source_tracks:
        if not isinstance(track_payload, dict):
            raise ValueError("Invalid portable track metadata")
        track = dict(track_payload)
        relative_path = str(track.get("relative_path") or "").strip()
        relative_path = relative_path or str(track.get("filename") or "")
        if not relative_path and track.get("path"):
            relative_path = Path(str(track["path"])).name
        relative = _safe_relative(relative_path)
        track["relative_path"] = str(relative)
        track["path"] = str(_contained_path(album_dir, relative))
        tracks.append(track)
    payload["tracks"] = tracks
    return payload


_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9._ -]+")


def _safe_segment(value: Any, fallback: str) -> str:
    text = str(value or "").strip() or fallback
    text = _SAFE_SEGMENT_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text or fallback


def _copy_artwork_files(
    source_album_dir: Path, export_album_dir: Path, names: list[str]
) -> int:
    copied = 0
    for name in names:
        source = _contained_path(source_album_dir, name)
        if not source.is_file():
            continue
        target = _contained_path(export_album_dir, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise ValueError("Artwork export destination already exists")
        _copy_regular_file(source, target)
        copied += 1
    return copied


def export_album_rich_metadata(
    album_payload: dict[str, Any],
    *,
    export_root: str | Path,
    include_audio: bool = True,
    write_rich_tags: bool = True,
) -> dict[str, Any]:
    source_album = album_payload.get("album") or {}
    if not source_album.get("path"):
        raise ValueError("Album path is required")
    artist_payload = album_payload.get("artist") or {}
    artist_name = (
        artist_payload.get("name") or source_album.get("artist") or "Unknown Artist"
    )
    album_name = (
        source_album.get("name") or source_album.get("tag_album") or "Unknown Album"
    )
    destination = _album_root(export_root)
    export_relative = Path(
        _safe_segment(artist_name, "Unknown Artist")
    ) / _safe_segment(album_name, "Unknown Album")
    export_album_dir = _contained_path(destination, export_relative)
    source_album_dir = _album_root(str(source_album.get("path") or ""))
    for track in album_payload.get("tracks") or []:
        _contained_path(source_album_dir, _track_relative(track, source_album_dir))
    artwork_names = list(
        source_album.get("artwork_files") or _find_artwork_files(source_album_dir)
    )
    for name in artwork_names:
        _contained_path(source_album_dir, name)
    export_album_dir = (
        destination
        / _safe_segment(artist_name, "Unknown Artist")
        / _safe_segment(album_name, "Unknown Album")
    )
    export_album_dir.mkdir(parents=True, exist_ok=False)

    export_payload = deepcopy(album_payload)
    export_album = dict(export_payload.get("album") or {})
    artwork_path = None
    if source_album_dir.is_dir():
        artwork_copied = _copy_artwork_files(
            source_album_dir, export_album_dir, artwork_names
        )
        artwork_path = find_album_artwork_file(source_album_dir, artwork_names)
    else:
        artwork_copied = 0

    artist_uid = artist_payload.get("entity_uid")
    album_uid = source_album.get("entity_uid")
    tracks_exported = 0
    tag_errors: list[dict[str, Any]] = []
    exported_tracks: list[dict[str, Any]] = []
    for track_payload in export_payload.get("tracks") or []:
        track = dict(track_payload)
        source_path = Path(str(track.get("path") or ""))
        relative_path = _track_relative(track, source_album_dir)
        target_path = _contained_path(export_album_dir, relative_path)
        if include_audio:
            if not source_path.is_file():
                tag_errors.append({"path": str(source_path), "error": "file not found"})
                continue
            target_path.parent.mkdir(parents=True, exist_ok=True)
            if target_path.exists():
                raise ValueError("Audio export destination already exists")
            _copy_regular_file(source_path, target_path)
            track["path"] = str(target_path)
            track["relative_path"] = str(target_path.relative_to(export_album_dir))
            tracks_exported += 1
            if write_rich_tags:
                tag_result = write_track_rich_tags(
                    target_path,
                    artist_uid=artist_uid,
                    album_uid=album_uid,
                    track_payload=track,
                    artwork_path=artwork_path,
                )
                if not tag_result.get("written") and tag_result.get("error"):
                    tag_errors.append(tag_result)
                elif tag_result.get("artwork_error"):
                    tag_errors.append(tag_result)
        else:
            track["path"] = str(target_path)
            track["relative_path"] = str(relative_path)
        exported_tracks.append(track)

    export_album["path"] = str(export_album_dir)
    export_album["artwork_files"] = _find_artwork_files(export_album_dir)
    export_payload["album"] = export_album
    export_payload["tracks"] = exported_tracks
    sidecar_path = write_album_sidecar(export_payload)

    return {
        "album_id": source_album.get("id"),
        "album_entity_uid": album_uid,
        "export_path": str(export_album_dir),
        "sidecar_path": str(sidecar_path),
        "tracks": tracks_exported if include_audio else len(exported_tracks),
        "artwork_files": artwork_copied,
        "tag_errors": tag_errors,
    }


__all__ = [
    "PORTABLE_SCHEMA_VERSION",
    "TAG_SCHEMA_VERSION",
    "export_album_rich_metadata",
    "find_album_artwork_file",
    "iter_album_sidecars",
    "load_album_sidecar",
    "write_album_portable_metadata",
    "write_album_sidecar",
    "write_track_identity_tags",
    "write_track_rich_tags",
]
