import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { TrackList } from "@crate/ui/domain/tracks";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { Button } from "@crate/ui/shadcn/button";
import { useLocation, useNavigate, useParams } from "react-router";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { ArtistReadState } from "@/components/artist/ArtistReadState";
import {
  buildArtistPlayerTrack,
  topTrackToTrackRowData,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import {
  albumCoverApiUrl,
  artistApiPath,
  artistPagePath,
  artistPhotoApiUrl,
  artistTopTracksPath,
} from "@/lib/library-routes";

function toPlayerTracks(tracks: ArtistTopTrack[]): Track[] {
  return tracks.map((track) =>
    buildArtistPlayerTrack(
      track,
      track.artist,
      artistPhotoApiUrl(
        {
          artistId: track.artist_id,
          artistEntityUid: track.artist_entity_uid,
          artistSlug: track.artist_slug,
          artistName: track.artist,
        },
        { size: 512 },
      ),
    ),
  );
}

export function ArtistTopTracks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { artistSlug: routeArtistSlug } = useParams<{ artistSlug?: string }>();
  const { playAll } = usePlayerActions();
  const {
    data: artist,
    loading: artistLoading,
    error: artistError,
    status: artistStatus,
    refetch: refetchArtist,
  } = useApi<{ id?: number; slug?: string; name: string }>(
    routeArtistSlug ? artistApiPath({ artistSlug: routeArtistSlug }) : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000, reportCachedErrors: true },
  );
  const artistName = artist?.name || "";
  const {
    data: topTracks,
    loading,
    error,
    refetch,
  } = useApi<ArtistTopTrack[]>(
    routeArtistSlug
      ? `/api/artist-slugs/${encodeURIComponent(
          routeArtistSlug,
        )}/top-tracks?count=50`
      : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000, reportCachedErrors: true },
  );

  useEffect(() => {
    if (!artist?.name || artistStatus === 404) return;
    const canonicalPath = artistTopTracksPath({
      artistId: artist.id,
      artistSlug: artist.slug,
      artistName: artist.name,
    });
    if (location.pathname !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [
    artist?.id,
    artist?.name,
    artist?.slug,
    artistStatus,
    location.pathname,
    navigate,
  ]);

  function handlePlayAll() {
    const queue = toPlayerTracks(topTracks || []);
    if (!queue.length) return;
    playAll(queue, 0, {
      type: "queue",
      name: t("actions.artist.topTracksSource", { name: artistName }),
    });
  }

  const trackRows = useMemo<TrackRowData[]>(
    () => (topTracks || []).map((track) => topTrackToTrackRowData(track)),
    [topTracks],
  );

  if (!artist || artistStatus === 404) {
    return (
      <ArtistReadState
        loading={artistLoading}
        error={artistError}
        status={artistStatus}
        onRetry={refetchArtist}
      />
    );
  }

  const artistPath = artistPagePath({
    artistId: artist.id,
    artistSlug: artist.slug,
    artistName,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        size="md"
        title={artistName}
        subtitle={t("artist.sections.topTracks")}
        back={<BackLink to={artistPath} label={t("common.back")} />}
        actions={
          <Button onClick={handlePlayAll} disabled={trackRows.length === 0}>
            <Play size={CRATE_ICON_SIZE.sm} fill="currentColor" />
            {t("player.play")}
          </Button>
        }
      />
      {artistError ? (
        <ErrorState
          title={t("artist.unavailable")}
          retryLabel={t("common.retry")}
          onRetry={refetchArtist}
        />
      ) : null}
      {error ? (
        <ErrorState
          title={t("artist.topTracks.unavailable")}
          retryLabel={t("common.retry")}
          onRetry={refetch}
        />
      ) : null}
      {loading && !topTracks ? (
        <LoadingState label={t("artist.topTracks.loading")} />
      ) : null}
      <TrackList
        label={t("artist.sections.topTracks")}
        items={trackRows}
        itemKey={(track, index) =>
          track.id ??
          track.global_track_uid ??
          track.entity_uid ??
          track.path ??
          index
        }
        empty={
          !loading && !error ? (
            <EmptyState
              variant="inline"
              title={t("actions.artist.toasts.noTopTracks")}
            />
          ) : null
        }
        renderRow={(_row, index) => {
          const track = topTracks![index]!;
          return (
            <TrackRow
              track={trackRows[index]!}
              index={track.track || index + 1}
              showAlbum
              albumCover={
                track.artist && track.album
                  ? albumCoverApiUrl(
                      {
                        albumId: track.album_id,
                        albumEntityUid: track.album_entity_uid,
                        globalAlbumUid: track.global_album_uid,
                        artistEntityUid: track.artist_entity_uid,
                        albumSlug: track.album_slug,
                        artistName: track.artist,
                        albumName: track.album,
                      },
                      { size: 128 },
                    )
                  : artistPhotoApiUrl(
                      {
                        artistId: track.artist_id,
                        artistEntityUid: track.artist_entity_uid,
                        artistSlug: track.artist_slug,
                        artistName: track.artist,
                      },
                      { size: 128 },
                    )
              }
              showCoverThumb
              queueTracks={trackRows}
            />
          );
        }}
      />
    </div>
  );
}
