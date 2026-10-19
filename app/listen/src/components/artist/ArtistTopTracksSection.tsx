import { ArtistTopTracksFrame } from "./ArtistLibraryFrames";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import {
  topTrackToTrackRowData,
  buildArtistAlbumCover,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import { artistTopTracksPath } from "@/lib/library-routes";

interface ArtistTopTracksSectionProps {
  artistId?: number;
  artistSlug?: string;
  tracks: ArtistTopTrack[];
  coverFallback?: string;
}

export function ArtistTopTracksSection({
  artistId,
  artistSlug,
  tracks,
  coverFallback,
}: ArtistTopTracksSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const topTracksPath =
    artistId != null || artistSlug
      ? artistTopTracksPath({ artistId, artistSlug })
      : "";
  const trackRows = useMemo<TrackRowData[]>(
    () => tracks.map((track) => topTrackToTrackRowData(track)),
    [tracks],
  );
  if (!tracks.length) return null;

  return (
    <ArtistTopTracksFrame
      title={t("artist.sections.topTracks")}
      actionLabel={topTracksPath ? t("common.viewAll") : undefined}
      onAction={() => navigate(topTracksPath)}
    >
      <TrackList
        items={tracks}
        itemKey={(track) =>
          track.id ??
          track.global_track_uid ??
          track.track_entity_uid ??
          track.library_track_id ??
          [track.artist, track.album, track.title].join(":")
        }
        renderRow={(track, index) => (
          <TrackRow
            key={
              track.id ??
              track.global_track_uid ??
              track.track_entity_uid ??
              track.library_track_id ??
              [track.artist, track.album, track.title].join(":")
            }
            track={trackRows[index]!}
            index={track.track || index + 1}
            showAlbum
            albumCover={
              track.album_id || track.global_album_uid
                ? buildArtistAlbumCover(
                    track.artist,
                    track.album,
                    track.album_id,
                    track.album_slug,
                    track.global_album_uid,
                  )
                : coverFallback
            }
            showCoverThumb
            queueTracks={trackRows}
          />
        )}
      />
    </ArtistTopTracksFrame>
  );
}
