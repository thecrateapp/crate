import type { TFunction } from "i18next";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Sparkles } from "@crate/ui/icons";
import { EmptyState, ErrorState } from "@crate/ui/domain/states";
import { notify } from "@crate/ui/lib/notify";

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

type ReleaseWindow =
  | { kind: "week"; index: number }
  | { kind: "currentAndPrevious" | "pastWeeks"; count: number };

export function newArrivalsWindow(
  data: HomeGeneratedPlaylistDetail | null,
): ReleaseWindow | null {
  if (!data || data.id !== "my-new-arrivals") return null;
  const indices = [
    ...new Set(
      data.tracks
        .map((track) => track.release_week_index)
        .filter(
          (index): index is number =>
            typeof index === "number" && Number.isInteger(index) && index >= 0,
        ),
    ),
  ].sort((a, b) => a - b);
  if (!indices.length) return null;
  if (indices.length === 1) return { kind: "week", index: indices[0]! };
  if (indices[0] === 0)
    return { kind: "currentAndPrevious", count: indices[indices.length - 1]! };
  return { kind: "pastWeeks", count: indices.length };
}

export function newArrivalsWindowLabel(
  data: HomeGeneratedPlaylistDetail | null,
  t: TFunction,
): string | null {
  const window = newArrivalsWindow(data);
  if (!window) return null;
  if (window.kind === "week")
    return window.index === 0
      ? t("home.playlists.arrivals.thisWeek")
      : t("home.playlists.arrivals.weeksAgo", { count: window.index });
  return t(
    window.kind === "currentAndPrevious"
      ? "home.playlists.arrivals.currentAndPrevious"
      : "home.playlists.arrivals.pastWeeks",
    { count: window.count },
  );
}

export function HomePlaylist() {
  const { t } = useTranslation();
  const { playlistId } = useParams<{ playlistId: string }>();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist, playlistOptions, ensurePlaylistOptionsLoaded } =
    usePlaylistComposer();
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);
  const { data, loading, error, status, refetch } =
    useApi<HomeGeneratedPlaylistDetail>(
      playlistId
        ? `/api/me/home/playlists/${encodeURIComponent(playlistId)}?v=2`
        : null,
      "GET",
      undefined,
      { safetyNetMs: 120_000 },
    );
  const releaseWindowLabel = useMemo(
    () => newArrivalsWindowLabel(data, t),
    [data, t],
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
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (!data || !playerTracks.length) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data.name,
      id: data.id,
      radio: { seedType: "playlist", seedId: data.id },
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

  if (!data && error && status !== 404)
    return (
      <ErrorState
        message={t("playlist.toasts.loadFailed")}
        retryLabel={t("common.retry")}
        onRetry={refetch}
      />
    );

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
          <InfoBadge icon={Sparkles} className="w-fit">
            {data.badge}
          </InfoBadge>
        }
        artwork={renderArtwork}
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        playDisabled={playerTracks.length === 0}
        shuffleDisabled={playerTracks.length === 0}
        secondaryActions={secondaryActions}
        menuItems={playlistMenuItems}
      />

      <div className="mx-auto w-full max-w-content space-y-6 px-4 pb-8 sm:px-6">
        <PlaylistTrackFilterBar
          query={filterQuery}
          onQueryChange={setFilterQuery}
          totalCount={data.tracks.length}
          filteredCount={filteredTracks.length}
        />

        {data.tracks.length === 0 ? (
          <EmptyState variant="inline" title={t("playlist.empty.noTracks")} />
        ) : filteredTracks.length === 0 ? (
          <EmptyState variant="inline" title={t("playlist.empty.noFilter")} />
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
