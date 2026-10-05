import { useEffect, useMemo, useRef } from "react";
import {
  TrackList,
  type TrackListVirtualListProps,
} from "@crate/ui/domain/tracks";

import { TrackRow } from "@/components/cards/TrackRow";
import type { PlaylistTrack } from "@/pages/playlist-types";
import { toTrackRowData } from "@/lib/track-row-data";
import { WindowVirtualList } from "@/components/ui/WindowVirtualList";
import type { TrackRowData } from "@/components/cards/TrackRow";

interface PlaylistTrackListRow {
  key: number | string;
  data: TrackRowData;
  onPlay: () => void;
}

function PlaylistTracksVirtualList({
  itemKey,
  ...props
}: TrackListVirtualListProps<PlaylistTrackListRow>) {
  return (
    <WindowVirtualList
      {...props}
      itemKey={
        itemKey ? (item, index) => String(itemKey(item, index)) : undefined
      }
    />
  );
}

export function PlaylistTrackList({
  filteredTracks,
  onActionMenuOpen,
  onAddToPlaylist,
  onCreatePlaylist,
  onPlayTrack,
  playlistOptions,
}: {
  filteredTracks: PlaylistTrack[];
  onActionMenuOpen: () => void;
  onAddToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => void | Promise<void>;
  onCreatePlaylist: (track: TrackRowData) => void | Promise<void>;
  onPlayTrack: (trackEntryId: number) => void;
  playlistOptions: { id: number; name: string }[];
}) {
  const onPlayTrackRef = useRef(onPlayTrack);
  useEffect(() => {
    onPlayTrackRef.current = onPlayTrack;
  }, [onPlayTrack]);

  const rows = useMemo<PlaylistTrackListRow[]>(
    () =>
      filteredTracks.map((track) => ({
        key: track.id ?? `${track.track_path}-${track.position}`,
        data: toTrackRowData({
          ...track,
          id: track.track_id ?? track.track_path ?? track.title,
          global_track_uid: track.global_track_uid,
          global_artist_uid: track.global_artist_uid,
          global_album_uid: track.global_album_uid,
          library_track_id: track.track_id,
        }),
        onPlay: () => onPlayTrackRef.current(track.id),
      })),
    [filteredTracks],
  );

  return (
    <TrackList
      items={rows}
      virtualList={PlaylistTracksVirtualList}
      itemKey={(row) => row.key}
      renderRow={(row, index) => (
        <TrackRow
          track={row.data}
          index={index + 1}
          showCoverThumb
          showArtist
          showAlbum
          playlistOptions={playlistOptions}
          onAddToPlaylist={onAddToPlaylist}
          onCreatePlaylist={onCreatePlaylist}
          onActionMenuOpen={onActionMenuOpen}
          onPlayOverride={row.onPlay}
        />
      )}
    />
  );
}
