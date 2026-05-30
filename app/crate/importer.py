"""Import queue: monitor download directories and import into library."""

import logging
import re
import shutil
from pathlib import Path
from threading import Lock

from crate.audio import get_audio_files, read_tags
from crate.storage_import import (
    DEFAULT_AUDIO_EXTENSIONS,
    resolve_import_album_target,
    resolve_managed_track_destination,
)

log = logging.getLogger(__name__)

# Download sources to monitor
DEFAULT_SOURCES = [
    {"name": "tidal", "path": "/music/.imports/tidal", "pattern": "{artist}/{album}"},
    {
        "name": "soulseek",
        "path": "/music/.imports/soulseek",
        "pattern": "{artist}/{album}",
    },
    {
        "name": "tidalrr",
        "path": "/music/.imports/tidalrr",
        "pattern": "{artist}/{album}",
    },
]


class ImportQueue:
    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))
        self.sources = config.get("import_sources", DEFAULT_SOURCES)
        self._queue: list[dict] = []
        self._lock = Lock()

    def scan_pending(self) -> list[dict]:
        """Scan all download directories for pending imports."""
        pending = []
        for source in self.sources:
            src_path = Path(source["path"])
            if not src_path.exists():
                continue

            for item in sorted(src_path.iterdir()):
                if not item.is_dir() or item.name.startswith("."):
                    continue

                # Could be artist dir or album dir directly
                albums = self._find_albums(item)
                for album_dir in albums:
                    tracks = get_audio_files(album_dir, self.extensions)
                    if not tracks:
                        continue

                    tags = read_tags(tracks[0])
                    artist = tags.get("albumartist") or tags.get("artist") or item.name
                    album = tags.get("album") or album_dir.name

                    dest = self.library_path / _sanitize(artist) / _sanitize(album)
                    exists = dest.exists()

                    pending.append(
                        {
                            "source": source["name"],
                            "source_path": str(album_dir),
                            "artist": artist,
                            "album": album,
                            "track_count": len(tracks),
                            "formats": list({t.suffix.lower() for t in tracks}),
                            "total_size_mb": round(
                                sum(t.stat().st_size for t in tracks) / (1024**2)
                            ),
                            "dest_path": str(dest),
                            "dest_exists": exists,
                            "status": "pending",
                        }
                    )

        with self._lock:
            self._queue = pending
        return pending

    def refresh_pending_state(self) -> list[dict]:
        """Scan download directories and persist the staged import read model."""
        pending = self.scan_pending()
        from crate.db.import_queue_read_models import refresh_import_queue_items

        refresh_import_queue_items(
            pending,
            scanned_sources=[
                str(source.get("name") or "filesystem") for source in self.sources
            ],
        )
        return pending

    def import_item(
        self,
        source_path: str,
        dest_artist: str | None = None,
        dest_album: str | None = None,
    ) -> dict:
        """Import a single album from source to library."""
        src = Path(source_path)
        if not src.exists() or not src.is_dir():
            return {"error": "Source path not found"}

        tracks = get_audio_files(src, self.extensions)
        if not tracks:
            return {"error": "No audio files found"}

        tags = read_tags(tracks[0])
        artist = str(
            dest_artist
            or tags.get("albumartist")
            or tags.get("artist")
            or "Unknown Artist"
        )
        album = str(dest_album or tags.get("album") or src.name)
        _artist_row, dest, managed_track_names = resolve_import_album_target(
            self.library_path,
            artist,
            album,
        )

        copied = 0
        skipped = 0
        dest.mkdir(parents=True, exist_ok=True)
        audio_extensions = {ext.lower() for ext in self.extensions}
        audio_extensions.update(DEFAULT_AUDIO_EXTENSIONS)
        for f in sorted(src.rglob("*")):
            if not f.is_file():
                continue
            relative = f.relative_to(src)
            if managed_track_names and f.suffix.lower() in audio_extensions:
                target = resolve_managed_track_destination(
                    f,
                    dest,
                    artist_name=artist,
                    album_name=album,
                    album_entity_uid=dest.name,
                    replace_existing_audio=True,
                )
            else:
                target = dest / relative
            if target.exists():
                skipped += 1
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(f), str(target))
            copied += 1

        if skipped:
            return {
                "status": "merged",
                "dest": str(dest),
                "copied": copied,
                "skipped": skipped,
                "artist": artist,
                "album": album,
            }
        return {
            "status": "imported",
            "dest": str(dest),
            "tracks": len(tracks),
            "artist": artist,
            "album": album,
        }

    def import_all(self, items: list[dict] | None = None) -> list[dict]:
        """Import multiple items."""
        if items is None:
            items = self.scan_pending()

        results = []
        for item in items:
            result = self.import_item(
                item["source_path"],
                str(item.get("artist") or ""),
                str(item.get("album") or ""),
            )
            result["source"] = item.get("source", "")
            result["source_path"] = item["source_path"]
            results.append(result)

        return results

    def remove_source(self, source_path: str) -> bool:
        """Remove imported source directory."""
        src = Path(source_path)
        if not src.exists():
            return False
        shutil.rmtree(str(src))
        return True

    def _find_albums(self, directory: Path) -> list[Path]:
        """Find album directories (dirs containing audio files)."""
        tracks = get_audio_files(directory, self.extensions)
        if tracks:
            return [directory]

        albums = []
        for child in sorted(directory.iterdir()):
            if child.is_dir() and not child.name.startswith("."):
                child_tracks = get_audio_files(child, self.extensions)
                if child_tracks:
                    albums.append(child)
        return albums


def _sanitize(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name.rstrip(". ") or "Unknown"
