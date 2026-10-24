import { MusicContextMenu } from "@/components/ui/music-context-menu";
import type { TopTrack } from "@/hooks/use-artist-data";
import { PopularityBar } from "./ArtistPageBits";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { formatCompact, formatDuration, formatDurationMs } from "@/lib/utils";
import { EntityRow } from "@crate/ui/domain/entity";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

interface SpotifyTopTrack {
  name: string;
  album: string;
  duration_ms: number;
  popularity: number;
}
interface ArtistTopTracksSectionProps {
  topTracks: TopTrack[];
  spotifyTopTracks?: SpotifyTopTrack[];
}

export function ArtistTopTracksSection({
  topTracks,
  spotifyTopTracks,
}: ArtistTopTracksSectionProps) {
  const additional = (spotifyTopTracks ?? []).filter(
    (spotifyTrack) =>
      !topTracks.some(
        (track) =>
          track.title.toLowerCase() === spotifyTrack.name.toLowerCase(),
      ),
  );
  if (topTracks.length === 0 && additional.length === 0)
    return (
      <p className="py-8 text-sm text-text-muted">No top tracks available</p>
    );
  return (
    <div className="min-w-0 space-y-[var(--content-list-gap)]">
      <TrackList
        label="Library top tracks"
        items={topTracks}
        itemKey={(track) => track.id}
        renderRow={(track, index) => {
          const coverUrl =
            albumCoverApiUrl({
              albumId: track.album_id,
              albumSlug: track.album_slug,
              artistName: track.artist,
              albumName: track.album,
            }) || undefined;
          return (
            <MusicContextMenu
              type="track"
              artist={track.artist}
              artistId={track.artist_id}
              artistSlug={track.artist_slug}
              album={track.album || ""}
              albumId={track.album_id}
              albumSlug={track.album_slug}
              trackId={track.id}
              trackTitle={track.title}
              albumCover={coverUrl}
            >
              <EntityRow
                title={track.title}
                rank={index + 1}
                subtitle={
                  track.album ? (
                    <MonoLabel as="span">{track.album}</MonoLabel>
                  ) : undefined
                }
                menuButton="none"
                disableItemActionTarget
                trailing={
                  <>
                    <MonoLabel as="span">
                      {formatDuration(track.duration)}
                    </MonoLabel>
                    {track.listeners ? (
                      <MonoLabel as="span">
                        {formatCompact(track.listeners)} listeners
                      </MonoLabel>
                    ) : null}
                  </>
                }
              />
            </MusicContextMenu>
          );
        }}
      />
      <TrackList
        label="Additional Spotify top tracks"
        items={additional}
        itemKey={(track) => `${track.name}-${track.album}`}
        renderRow={(track, index) => (
          <EntityRow
            title={track.name}
            rank={topTracks.length + index + 1}
            subtitle={<MonoLabel as="span">{track.album}</MonoLabel>}
            meta={<MonoLabel as="span">Spotify</MonoLabel>}
            menuButton="none"
            trailing={
              <>
                <MonoLabel as="span">
                  {formatDurationMs(track.duration_ms)}
                </MonoLabel>
                <PopularityBar value={track.popularity} />
              </>
            }
          />
        )}
      />
    </div>
  );
}
