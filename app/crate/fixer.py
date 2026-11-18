import logging
import shutil
from pathlib import Path

from crate.models import Issue, IssueType
from crate.storage_layout import UnsafeMutationPathError, ensure_within_roots

log = logging.getLogger(__name__)


class LibraryFixer:
    def __init__(self, config: dict):
        self.config = config
        self.threshold = config.get("confidence_threshold", 90)
        self.library_root = Path(config.get("library_path", "/music"))
        self.trash_dir = self.library_root / ".crate-trash"

    def fix(self, issues: list[Issue], dry_run: bool = True):
        auto = [i for i in issues if i.confidence >= self.threshold]
        manual = [i for i in issues if i.confidence < self.threshold]

        log.info(
            "Issues: %d total, %d auto-fixable (confidence >= %d), %d need review",
            len(issues),
            len(auto),
            self.threshold,
            len(manual),
        )

        if dry_run:
            log.info("DRY RUN - no changes will be made")

        for issue in auto:
            handler = self._get_handler(issue.type)
            if handler:
                try:
                    handler(issue, dry_run)
                except UnsafeMutationPathError as error:
                    log.warning("Skipping %s: %s", issue.type.value, error)

        if manual:
            log.info("--- Issues requiring manual review ---")
            for issue in manual:
                log.info(
                    "[%s] confidence=%d: %s -> %s",
                    issue.type.value,
                    issue.confidence,
                    issue.description,
                    issue.suggestion,
                )

    def _ensure_in_library(self, *paths: Path) -> None:
        for path in paths:
            ensure_within_roots(path, (self.library_root,))

    def _get_handler(self, issue_type: IssueType):
        return {
            IssueType.NESTED_LIBRARY: self._fix_nested,
            IssueType.DUPLICATE_ALBUM: self._fix_duplicate,
            IssueType.MERGEABLE_ALBUM: self._fix_mergeable,
            IssueType.BAD_NAMING: self._fix_naming,
        }.get(issue_type)

    def _safe_move_to_trash(self, path: Path, dry_run: bool):
        """Move to .crate-trash instead of deleting."""
        self._ensure_in_library(path)
        dest = self.trash_dir / path.relative_to(Path(self.config["library_path"]))
        if dry_run:
            log.info("  [DRY] Would move to trash: %s -> %s", path, dest)
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(dest))
        log.info("  Moved to trash: %s", path)

    def _fix_nested(self, issue: Issue, dry_run: bool):
        """Move contents of nested library up to library root."""
        nested_path = Path(issue.details["nested_path"])
        library_root = Path(self.config["library_path"])

        log.info("Fixing nested library: %s", nested_path)
        self._ensure_in_library(nested_path)

        for artist_dir in sorted(nested_path.iterdir()):
            if not artist_dir.is_dir():
                continue

            target = library_root / artist_dir.name
            self._ensure_in_library(artist_dir, target)

            if target.exists():
                # Merge: move album dirs into existing artist
                for album_dir in sorted(artist_dir.iterdir()):
                    if not album_dir.is_dir():
                        continue
                    album_target = target / album_dir.name
                    if album_target.exists():
                        log.info("  [SKIP] Album already exists: %s", album_target)
                        continue
                    if dry_run:
                        log.info(
                            "  [DRY] Would move: %s -> %s", album_dir, album_target
                        )
                    else:
                        shutil.move(str(album_dir), str(album_target))
                        log.info("  Moved: %s -> %s", album_dir, album_target)
            else:
                if dry_run:
                    log.info("  [DRY] Would move: %s -> %s", artist_dir, target)
                else:
                    shutil.move(str(artist_dir), str(target))
                    log.info("  Moved: %s -> %s", artist_dir, target)

    def _fix_duplicate(self, issue: Issue, dry_run: bool):
        """Keep the best album, trash the rest."""
        keep = issue.details["keep"]
        remove = issue.details["remove"]

        log.info("Fixing duplicate: keeping %s", keep)
        for path_str in remove:
            self._safe_move_to_trash(Path(path_str), dry_run)

    def _fix_mergeable(self, issue: Issue, dry_run: bool):
        """Merge tracks from source albums into target album."""
        target = Path(issue.details["target"])
        sources = [Path(s) for s in issue.details["sources"]]

        log.info("Merging into: %s", target)
        self._ensure_in_library(target, *sources)

        for source in sources:
            for f in sorted(source.iterdir()):
                if not f.is_file():
                    continue
                dest = target / f.name
                if dest.exists():
                    log.info("  [SKIP] Already exists: %s", dest.name)
                    continue
                if dry_run:
                    log.info("  [DRY] Would move: %s -> %s", f, dest)
                else:
                    shutil.move(str(f), str(dest))
                    log.info("  Moved: %s -> %s", f.name, dest)

            # Trash empty source directory
            self._safe_move_to_trash(source, dry_run)

    def _fix_naming(self, issue: Issue, dry_run: bool):
        """Rename folder to cleaned name."""
        current = Path(issue.paths[0])
        proposed = issue.details["proposed"]
        new_path = current.parent / proposed
        self._ensure_in_library(current, new_path)

        if new_path.exists():
            log.info("  [SKIP] Target already exists: %s", new_path)
            return

        if dry_run:
            log.info("  [DRY] Would rename: %s -> %s", current.name, proposed)
        else:
            current.rename(new_path)
            log.info("  Renamed: %s -> %s", current.name, proposed)
