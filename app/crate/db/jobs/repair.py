from crate.db.jobs.repair_artist_jobs import (
    count_artist_tracks,
    find_artist_canonical,
    find_canonical_artist_by_folder,
    merge_artist_into_artist,
    rename_artist,
    update_artist_has_photo,
)
from crate.db.jobs.repair_media_jobs import (
    count_valid_album_tracks,
    create_split_album_and_move_tracks,
    get_tracks_by_paths,
    merge_album_into_album,
    merge_album_folder,
    reassign_album_artist,
    update_album_artist_and_path,
    update_album_path_and_name,
    update_track_artist,
)


__all__ = [
    "count_artist_tracks",
    "count_valid_album_tracks",
    "create_split_album_and_move_tracks",
    "find_artist_canonical",
    "find_canonical_artist_by_folder",
    "merge_artist_into_artist",
    "get_tracks_by_paths",
    "merge_album_into_album",
    "merge_album_folder",
    "reassign_album_artist",
    "rename_artist",
    "update_album_artist_and_path",
    "update_album_path_and_name",
    "update_artist_has_photo",
    "update_track_artist",
]
