"""Filesystem metadata heuristics; this does not decode or validate audio streams."""

import logging
from collections.abc import Callable
from pathlib import Path

import mutagen

from crate.audio import read_tags

log = logging.getLogger(__name__)

LOSSLESS = {".flac", ".wav", ".alac"}
LOSSY = {".mp3", ".m4a", ".ogg", ".opus", ".wma"}


class QualityScanCancelled(Exception):
    pass


def quality_report(
    library_path: Path,
    extensions: set[str],
    *,
    cancelled: Callable[[], bool] | None = None,
) -> dict:
    """Inspect metadata in the library, checking cancellation before each file."""
    root = library_path.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Library directory is unavailable")

    def checkpoint():
        if cancelled is not None and cancelled():
            raise QualityScanCancelled()

    def contained(path: Path) -> bool:
        current = root
        for part in path.relative_to(root).parts:
            current = current / part
            if current.is_symlink():
                return False
        return path.resolve().is_relative_to(root)

    low_bitrate = []
    lossy_with_lossless = []
    corrupt = []
    mixed_format_albums = []

    skipped_paths = 0
    scanned_tracks = 0
    for artist_dir in sorted(root.iterdir()):
        checkpoint()
        if not contained(artist_dir):
            skipped_paths += 1
            continue
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue

        album_versions: dict[str, list[dict]] = {}

        album_tracks: dict[Path, list[Path]] = {}
        pending: list[tuple[Path, Path | None]] = [(artist_dir, None)]
        while pending:
            directory, album_root = pending.pop()
            checkpoint()
            if not contained(directory):
                skipped_paths += 1
                continue
            child_directories = []
            for child in sorted(directory.iterdir()):
                checkpoint()
                if not contained(child):
                    skipped_paths += 1
                    continue
                if child.name.startswith("."):
                    continue
                if child.is_dir():
                    logical_root = album_root
                    if logical_root is None and not (
                        directory == artist_dir
                        and child.name.isdigit()
                        and len(child.name) == 4
                    ):
                        logical_root = child
                    child_directories.append((child, logical_root))
                elif child.suffix.lower() in extensions and child.is_file():
                    album_tracks.setdefault(album_root or directory, []).append(child)
            pending.extend(reversed(child_directories))

        for album_dir, tracks in album_tracks.items():
            album_path = str(album_dir.relative_to(artist_dir))
            album_formats = set()
            lossless_formats = set()
            lossy_formats = set()

            for track in tracks:
                checkpoint()
                if not contained(track):
                    skipped_paths += 1
                    continue
                scanned_tracks += 1
                fmt = track.suffix.lower()
                album_formats.add(fmt)

                try:
                    mutagen_file = getattr(mutagen, "File")
                    info = mutagen_file(track)
                    if info is None:
                        corrupt.append(
                            {
                                "artist": artist_dir.name,
                                "album": album_dir.name,
                                "album_path": album_path,
                                "file": str(track.relative_to(album_dir)),
                                "reason": "Cannot read file",
                                "evidence": "metadata_unreadable",
                                "confirmed_corruption": False,
                            }
                        )
                        continue

                    codec = str(getattr(info.info, "codec", "")).lower()
                    lossless = fmt in LOSSLESS or "alac" in codec
                    if lossless:
                        lossless_formats.add(fmt)
                    elif fmt in LOSSY:
                        lossy_formats.add(fmt)

                    length = getattr(info.info, "length", 0)
                    if not length or length < 1:
                        corrupt.append(
                            {
                                "artist": artist_dir.name,
                                "album": album_dir.name,
                                "album_path": album_path,
                                "file": str(track.relative_to(album_dir)),
                                "reason": f"Zero/invalid duration ({length:.1f}s)",
                                "evidence": "duration_suspicious",
                                "confirmed_corruption": False,
                            }
                        )
                        continue

                    if fmt in LOSSY and not lossless:
                        bitrate = getattr(info.info, "bitrate", 0)
                        if bitrate and bitrate < 192000:
                            low_bitrate.append(
                                {
                                    "artist": artist_dir.name,
                                    "album": album_dir.name,
                                    "album_path": album_path,
                                    "file": str(track.relative_to(album_dir)),
                                    "format": fmt,
                                    "bitrate_kbps": bitrate // 1000,
                                    "evidence": "bitrate_heuristic",
                                }
                            )

                except Exception as exc:
                    corrupt.append(
                        {
                            "artist": artist_dir.name,
                            "album": album_dir.name,
                            "album_path": album_path,
                            "file": str(track.relative_to(album_dir)),
                            "reason": f"Metadata reader failed ({type(exc).__name__})",
                            "evidence": "metadata_unreadable",
                            "confirmed_corruption": False,
                        }
                    )

            # Mixed format album
            if len(album_formats) > 1:
                mixed_format_albums.append(
                    {
                        "artist": artist_dir.name,
                        "album": album_dir.name,
                        "album_path": album_path,
                        "formats": sorted(album_formats),
                        "track_count": len(tracks),
                    }
                )

            tags = read_tags(tracks[0])
            album_name = _normalize_album(tags.get("album", "") or album_dir.name)
            album_versions.setdefault(album_name, []).append(
                {
                    "dir": album_path,
                    "formats": album_formats,
                    "track_count": len(tracks),
                    "has_lossless": bool(lossless_formats),
                    "has_lossy": bool(lossy_formats),
                }
            )

        for versions in album_versions.values():
            has_any_lossless = any(v["has_lossless"] for v in versions)
            for v in versions:
                if v["has_lossy"] and not v["has_lossless"] and has_any_lossless:
                    lossy_with_lossless.append(
                        {
                            "artist": artist_dir.name,
                            "lossy_album": v["dir"],
                            "lossy_formats": sorted(v["formats"] & LOSSY),
                            "lossless_album": next(
                                x["dir"] for x in versions if x["has_lossless"]
                            ),
                            "evidence": "normalized_album_name_heuristic",
                            "same_edition_verified": False,
                        }
                    )

    checkpoint()
    return {
        "ready": True,
        "computing": False,
        "scanned_tracks": scanned_tracks,
        "skipped_unsafe_paths": skipped_paths,
        "coverage": "partial" if skipped_paths else "metadata_only",
        "method": "metadata_heuristics_v1",
        "audio_decode_verified": False,
        "semantics": {
            "corrupt": "Legacy key: unreadable metadata or suspicious duration; corruption is unconfirmed",
            "low_bitrate": "Bitrate below 192 kbps; not an acoustic quality measurement",
            "lossy_with_lossless": "Normalized album-name match; edition and master equivalence are unverified",
        },
        "low_bitrate": low_bitrate,
        "low_bitrate_count": len(low_bitrate),
        "lossy_with_lossless": lossy_with_lossless,
        "lossy_with_lossless_count": len(lossy_with_lossless),
        "corrupt": corrupt,
        "corrupt_count": len(corrupt),
        "mixed_format_albums": mixed_format_albums,
        "mixed_format_count": len(mixed_format_albums),
    }


def _normalize_album(name: str) -> str:
    import re

    name = name.lower().strip()
    name = re.sub(r"\s*\(.*?\)\s*", "", name)
    name = re.sub(r"\s*\[.*?\]\s*", "", name)
    name = re.sub(r"[^a-z0-9\s]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name
