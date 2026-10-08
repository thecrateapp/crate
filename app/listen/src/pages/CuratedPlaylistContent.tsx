import {
  TrackList,
  type TrackListVirtualListProps,
} from "@crate/ui/domain/tracks";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";

import { TrackRow } from "@/components/cards/TrackRow";
import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import { PlaylistHeroSection } from "@/components/playlists/PlaylistHeroSection";
import { PlaylistTrackFilterBar } from "@/components/playlists/PlaylistTrackFilterBar";
import { WindowVirtualList } from "@/components/ui/WindowVirtualList";
import { toTrackRowData } from "@/lib/track-row-data";
import type { CuratedPlaylistTrack } from "@/pages/curated-playlist-types";
import type { CuratedPlaylistPageController } from "@/pages/use-curated-playlist-page-controller";

function CuratedTracksVirtualList({
  itemKey,
  ...props
}: TrackListVirtualListProps<CuratedPlaylistTrack>) {
  return (
    <WindowVirtualList
      {...props}
      itemKey={
        itemKey ? (item, index) => String(itemKey(item, index)) : undefined
      }
    />
  );
}

export function CuratedPlaylistContent({
  page,
}: {
  page: CuratedPlaylistPageController;
}) {
  const {
    data,
    filterQuery,
    filteredTracks,
    handleAddTrackToPlaylist,
    handleCreatePlaylistFromTrack,
    handlePlay,
    handlePlayTrack,
    handleShuffle,
    offlineState,
    offlineStatusDetail,
    playlistMenuItems,
    playlistMetaItems,
    playlistOptions,
    playerTracks,
    secondaryActions,
    setFilterQuery,
    t,
    ensurePlaylistOptionsLoaded,
  } = page;

  if (!data) return null;

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <PlaylistHeroSection
        title={data.name}
        subtitle={t("playlist.subtitle.crate")}
        description={data.description}
        metaItems={playlistMetaItems}
        badges={<OfflineBadge state={offlineState} />}
        artwork={(className) => (
          <PlaylistArtwork
            name={data.name}
            coverDataUrl={data.cover_data_url}
            tracks={data.artwork_tracks}
            className={className}
          />
        )}
        menuImageUrl={data.cover_data_url}
        menuImageAlt={data.name}
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        playDisabled={playerTracks.length === 0}
        shuffleDisabled={playerTracks.length === 0}
        secondaryActions={secondaryActions}
        menuItems={playlistMenuItems}
      />

      <div className="mx-auto w-full max-w-content space-y-6 px-4 pb-8 sm:px-6">
        {offlineStatusDetail ? (
          <p className="text-xs text-text-muted">{offlineStatusDetail}</p>
        ) : null}

        <PlaylistTrackFilterBar
          query={filterQuery}
          onQueryChange={setFilterQuery}
          totalCount={data.tracks.length}
          filteredCount={filteredTracks.length}
        />

        {data.tracks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-text-muted">
              {t("playlist.empty.noTracks")}
            </p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-text-muted">
              {t("playlist.empty.noFilter")}
            </p>
          </div>
        ) : (
          <TrackList
            items={filteredTracks}
            virtualList={CuratedTracksVirtualList}
            overscan={12}
            itemKey={(track) => track.id}
            renderRow={(track, index) => (
              <TrackRow
                track={toTrackRowData({
                  ...track,
                  id: track.track_id ?? track.track_path ?? track.title,
                  library_track_id: track.track_id,
                })}
                index={index + 1}
                showCoverThumb
                showArtist
                showAlbum
                playlistOptions={playlistOptions}
                onAddToPlaylist={handleAddTrackToPlaylist}
                onCreatePlaylist={handleCreatePlaylistFromTrack}
                onActionMenuOpen={ensurePlaylistOptionsLoaded}
                onPlayOverride={() => handlePlayTrack(track.id)}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
