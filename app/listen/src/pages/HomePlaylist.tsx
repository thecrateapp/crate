import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Sparkles } from "@crate/ui/icons";
import { EmptyState, ErrorState } from "@crate/ui/domain/states";
import { notify } from "@crate/ui/lib/notify";
import { CratePill } from "@crate/ui/primitives/CrateBadge";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CoreTracksArtwork } from "@/components/home/CoreTracksArtwork";
import { MixArtwork } from "@/components/home/MixArtwork";
import type { HomeGeneratedPlaylistDetail } from "@/components/home/home-model";
import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import { PlaylistHeroSection } from "@/components/playlists/PlaylistHeroSection";
import {
  PlaylistTrackFilterBar,
  filterPlaylistTracks,
} from "@/components/playlists/PlaylistTrackFilterBar";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";
import { toTrackRowData } from "@/lib/track-row-data";
import { fetchHomePlaylistRadio } from "@/lib/radio";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { formatTotalDuration, shuffleArray } from "@/lib/utils";
import { buildPlaylistPageActions } from "@/pages/playlist-action-menus";

export function newArrivalsWindowLabel(
  data: HomeGeneratedPlaylistDetail | null,
): string | null {
  if (!data || data.id !== "my-new-arrivals") return null;
  const bucketIndexes = Array.from(
    new Set(
      data.tracks
        .map((track) => track.release_week_index)
        .filter((value): value is number => typeof value === "number"),
    ),
  ).sort((a, b) => a - b);
  if (!bucketIndexes.length) return null;

  const firstLabel =
    data.tracks.find((track) => track.release_week_index === bucketIndexes[0])
      ?.release_week_label || null;
  if (bucketIndexes.length === 1) {
    return firstLabel;
  }
  if (bucketIndexes[0] === 0) {
    const previousWeeks = Math.max(...bucketIndexes);
    return `This week + ${previousWeeks} previous week${
      previousWeeks === 1 ? "" : "s"
    }`;
  }
  return `Past ${bucketIndexes.length} release weeks`;
}

export function HomePlaylist() {
  const { t } = useTranslation();
  const { playlistId } = useParams<{ playlistId: string }>();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist, playlistOptions, ensurePlaylistOptionsLoaded } =
    usePlaylistComposer();
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);
  const { data, loading } = useApi<HomeGeneratedPlaylistDetail>(
    playlistId
      ? `/api/me/home/playlists/${encodeURIComponent(playlistId)}?v=2`
      : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const releaseWindowLabel = useMemo(
    () => newArrivalsWindowLabel(data),
    [data],
  );

  const playerTracks = useMemo(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map(
      (track): Track =>
        toPlayableTrack(track, {
          cover:
            track.artist && track.album
              ? albumCoverApiUrl(
                  {
                    albumId: track.album_id || undefined,
                    albumEntityUid: track.album_entity_uid || undefined,
                    artistEntityUid: track.artist_entity_uid || undefined,
                    albumSlug: track.album_slug || undefined,
                    artistName: track.artist,
                    albumName: track.album,
                  },
                  { size: 512 },
                ) || undefined
              : undefined,
        }),
    );
  }, [data]);

  const filteredTracks = useMemo(
    () => filterPlaylistTracks(data?.tracks || [], deferredFilterQuery),
    [data?.tracks, deferredFilterQuery],
  );

  const trackRows = useMemo<TrackRowData[]>(
    () =>
      filteredTracks.map((track) =>
        toTrackRowData({
          ...track,
          id: track.track_id ?? track.track_path ?? track.title,
          library_track_id: track.track_id,
        }),
      ),
    [filteredTracks],
  );

  function handlePlay() {
    if (!data || !playerTracks.length) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data.name,
      id: data.id,
    });
  }

  function handleShuffle() {
    if (!data || !playerTracks.length) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data.name,
      id: data.id,
    });
  }

  async function handleShare() {
    if (!data) return;
    openShareSheet({
      kind: "playlist",
      title: data.name,
      subtitle: data.description,
      url: publicShareUrl(`/home/playlist/${encodeURIComponent(data.id)}`),
    });
  }

  async function handleRadio() {
    if (!data) return;
    try {
      const radio = await fetchHomePlaylistRadio({
        playlistId: data.id,
        playlistName: data.name,
      });
      if (!radio.tracks.length) {
        notify.info(t("playlist.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      notify.error(t("playlist.toasts.radioFailed"));
    }
  }

  async function handleAddTrackToPlaylist(
    targetPlaylistId: number,
    track: TrackRowData,
  ) {
    if (!hasTrackReference(track)) return;
    try {
      await api(`/api/playlists/${targetPlaylistId}/tracks`, "POST", {
        tracks: [
          toTrackReferencePayload({
            ...track,
            album: track.album || "",
            duration: track.duration || 0,
          }),
        ],
      });
      notify.success(t("playlist.toasts.trackAdded"));
    } catch {
      notify.error(t("playlist.toasts.trackAddFailed"));
    }
  }

  function handleCreatePlaylistFromTrack(track: TrackRowData) {
    openCreatePlaylist({
      tracks: hasTrackReference(track) ? [toPlayableTrack(track)] : [],
    });
  }

  if (loading) {
    return <CrateLoader label={t("playlist.loading")} />;
  }

  if (!data) {
    return (
      <ErrorState
        kind="notFound"
        title={t("playlist.notFound")}
        backTo="/"
        backLabel={t("common.back")}
      />
    );
  }

  const { secondaryActions, playlistMenuItems } = buildPlaylistPageActions({
    t,
    playDisabled: playerTracks.length === 0,
    onPlay: handlePlay,
    onShuffle: handleShuffle,
    onRadio: handleRadio,
    onShare: handleShare,
  });
  const playlistMetaItems = [
    t("common.trackCountLabel", { count: data.track_count }),
    data.total_duration > 0 ? formatTotalDuration(data.total_duration) : null,
    releaseWindowLabel,
    t("playlist.generatedForYou"),
  ];
  const renderArtwork = (className: string) =>
    data.kind === "core" ? (
      <CoreTracksArtwork item={data} className={className} />
    ) : data.kind === "mix" ? (
      <MixArtwork item={data} className={className} />
    ) : (
      <PlaylistArtwork
        name={data.name}
        tracks={data.artwork_tracks}
        className={className}
      />
    );

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <PlaylistHeroSection
        title={data.name}
        subtitle={t("playlist.subtitle.generated")}
        description={data.description}
        metaItems={playlistMetaItems}
        badges={
          <CratePill
            tone="accent"
            icon={Sparkles}
            className="w-fit gap-2 px-3 text-xs font-medium uppercase tracking-wider"
          >
            {data.badge}
          </CratePill>
        }
        artwork={renderArtwork}
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        playDisabled={playerTracks.length === 0}
        shuffleDisabled={playerTracks.length === 0}
        secondaryActions={secondaryActions}
        menuItems={playlistMenuItems}
      />

      <div className="mx-auto w-full max-w-[1480px] space-y-6 px-4 pb-8 sm:px-6">
        <PlaylistTrackFilterBar
          query={filterQuery}
          onQueryChange={setFilterQuery}
          totalCount={data.tracks.length}
          filteredCount={filteredTracks.length}
        />

        {data.tracks.length === 0 ? (
          <EmptyState variant="inline" message={t("playlist.empty.noTracks")} />
        ) : filteredTracks.length === 0 ? (
          <EmptyState variant="inline" message={t("playlist.empty.noFilter")} />
        ) : (
          <div className="space-y-1">
            {trackRows.map((row, index) => (
              <TrackRow
                key={
                  row.id ??
                  row.global_track_uid ??
                  row.entity_uid ??
                  row.path ??
                  [row.artist, row.album, row.title].join(":")
                }
                track={row}
                index={index + 1}
                showCoverThumb
                showArtist
                showAlbum
                playlistOptions={playlistOptions}
                onAddToPlaylist={handleAddTrackToPlaylist}
                onCreatePlaylist={handleCreatePlaylistFromTrack}
                onActionMenuOpen={ensurePlaylistOptionsLoaded}
                queueTracks={trackRows}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
