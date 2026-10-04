import { useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  useItemActionMenu,
  type ItemActionMenuEntry,
} from "@/components/actions/ItemActionMenu";
import { buildTrackMenuPlayerTrack } from "@/components/actions/shared";
import { useOffline } from "@/contexts/OfflineContext";
import {
  usePlayerActions,
  type PlaySource,
  type Track,
} from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import {
  hasPlayableTrackReference,
  resolvePlayableTrackId,
  toPlayableTrack,
} from "@/lib/playable-track";
import { resolveRemotePlayableTrack } from "@/lib/remote-track-playback";
import { getOfflineStateLabel } from "@/lib/offline";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { notify } from "@crate/ui/lib/notify";

export interface TrackRowData {
  id?: string | number;
  global_track_uid?: string;
  global_artist_uid?: string;
  global_album_uid?: string;
  entity_uid?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album?: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration?: number;
  path?: string;
  track_number?: number;
  format?: string;
  bitrate?: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  library_track_id?: number;
  origin?: "local" | "remote";
  node_uid?: string;
  node_name?: string;
  remote_entity_uid?: string;
  availability?: {
    catalog: boolean;
    stream: boolean;
    import: boolean;
    stale?: boolean;
    local?: boolean;
    remote?: boolean;
    healthy?: boolean;
  };
  disabled?: boolean;
}

interface TrackRowPlaylistOption {
  id: number;
  name: string;
}

export interface TrackRowProps {
  track: TrackRowData;
  index?: number;
  showArtist?: boolean;
  showAlbum?: boolean;
  albumCover?: string;
  showCoverThumb?: boolean;
  playlistOptions?: TrackRowPlaylistOption[];
  onAddToPlaylist?: (
    playlistId: number,
    track: TrackRowData,
  ) => void | Promise<void>;
  onCreatePlaylist?: (track: TrackRowData) => void | Promise<void>;
  onActionMenuOpen?: () => void;
  onPlayOverride?: () => void;
  isActiveOverride?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (track: TrackRowData, event: MouseEvent<HTMLDivElement>) => void;
  onSelectionActionMenuOpen?: (
    track: TrackRowData,
    event: MouseEvent<HTMLButtonElement>,
  ) => boolean | void;
  /** Pass the full sibling track list so clicking plays all from this track's position. */
  queueTracks?: TrackRowData[];
  playSource?: PlaySource;
  rank?: number;
  meta?: ReactNode;
  density?: "default" | "compact";
  extraActions?: ItemActionMenuEntry[];
  showLike?: boolean;
  showDuration?: boolean;
}

const NO_ACTIONS: ItemActionMenuEntry[] = [];

export type TrackRowResolvedState = {
  cover?: string;
  playerTrack: Track;
  isRemote: boolean;
  isGlobalCatalogOnly: boolean;
  showLocalActions: boolean;
  hasLinkActions: boolean;
  disabled: boolean;
  playbackId: string;
};

function resolveTrackRowState(
  track: TrackRowData,
  albumCover?: string,
): TrackRowResolvedState {
  const globalAlbumUid = track.global_album_uid;
  const cover =
    albumCover ||
    (globalAlbumUid
      ? albumCoverApiUrl({ globalAlbumUid }, { size: 128 })
      : track.album_id != null
        ? albumCoverApiUrl(
            {
              albumId: track.album_id,
              albumEntityUid: track.album_entity_uid,
              artistEntityUid: track.artist_entity_uid,
              albumSlug: track.album_slug,
              artistName: track.artist,
              albumName: track.album,
            },
            { size: 128 },
          )
        : undefined);
  const playerTrack = toPlayableTrack(track, { cover });
  const isRemote = playerTrack.origin === "remote";
  const isGlobalCatalogOnly =
    Boolean(playerTrack.globalTrackUid || track.global_track_uid) &&
    track.availability?.local === false &&
    playerTrack.libraryTrackId == null;
  const showLocalActions = !isRemote && !isGlobalCatalogOnly;
  const disabled =
    Boolean(track.disabled) ||
    (isRemote && playerTrack.remote?.availability.stream === false) ||
    (isGlobalCatalogOnly && track.availability?.healthy === false);

  const hasLinkActions = Boolean(
    track.artist_id != null ||
      track.global_artist_uid ||
      track.album_id != null ||
      track.global_album_uid,
  );

  return {
    cover,
    playerTrack,
    isRemote,
    isGlobalCatalogOnly,
    showLocalActions,
    hasLinkActions,
    disabled,
    playbackId: resolvePlayableTrackId(track),
  };
}

export function useTrackRowModel({
  track,
  albumCover,
  extraActions,
}: Pick<TrackRowProps, "track" | "albumCover" | "extraActions">) {
  const { isLiked } = useLikedTracks();
  const { getTrackState } = useOffline();
  const resolved = resolveTrackRowState(track, albumCover);
  const hasTrackRef = hasPlayableTrackReference(track);
  const liked = hasTrackRef
    ? isLiked(
        track.library_track_id ??
          (typeof track.id === "number" ? track.id : null),
        track.entity_uid,
        track.path,
        track.global_track_uid,
      )
    : false;
  const offlineState = resolved.showLocalActions
    ? getTrackState(track.entity_uid)
    : "idle";
  const offlineLabel = resolved.showLocalActions
    ? getOfflineStateLabel(offlineState)
    : "";
  const actionMenu = useItemActionMenu(NO_ACTIONS, {
    placement: "bottom-end",
    hasActions:
      !resolved.disabled &&
      (resolved.showLocalActions ||
        resolved.hasLinkActions ||
        Boolean(extraActions?.length)),
  });

  return {
    ...resolved,
    actionMenu,
    hasTrackRef,
    liked,
    offlineLabel,
    offlineState,
  };
}

function isQueueableTrackRow(track: TrackRowData): boolean {
  return (
    hasPlayableTrackReference(track) && !resolveTrackRowState(track).disabled
  );
}

async function activateTrack({
  disabled,
  isActive,
  isPlaying,
  onPlayOverride,
  onRemotePlayback,
  pause,
  play,
  playAll,
  playerTrack,
  playSource,
  queueTracks,
  resume,
  track,
}: {
  disabled: boolean;
  isActive: boolean;
  isPlaying: boolean;
  onPlayOverride?: () => void;
  onRemotePlayback: () => Promise<void>;
  pause: () => void;
  play: (track: Track) => void;
  playAll: (tracks: Track[], index?: number, source?: PlaySource) => void;
  playerTrack: Track;
  playSource?: PlaySource;
  queueTracks?: TrackRowData[];
  resume: () => void;
  track: TrackRowData;
}) {
  if (disabled) return;
  if (isActive) {
    if (isPlaying) pause();
    else resume();
    return;
  }
  if (onPlayOverride) {
    await onPlayOverride();
    return;
  }
  if (playerTrack.origin === "remote") {
    await onRemotePlayback();
    return;
  }
  if (queueTracks && queueTracks.length > 1) {
    const playableRows = queueTracks.filter(isQueueableTrackRow);
    const myId = resolvePlayableTrackId(track);
    const idx = playableRows.findIndex(
      (queueTrack) => resolvePlayableTrackId(queueTrack) === myId,
    );
    if (idx >= 0) {
      const tracks = playableRows.map((queueTrack) =>
        buildTrackMenuPlayerTrack(queueTrack),
      );
      if (playSource) playAll(tracks, idx, playSource);
      else playAll(tracks, idx);
      return;
    }
  }
  play(playerTrack);
}

export function useTrackRowPlayback({
  disabled,
  isActive,
  isPlaying,
  onPlayOverride,
  playerTrack,
  playSource,
  queueTracks,
  track,
}: Pick<TrackRowResolvedState, "disabled" | "playerTrack"> & {
  isActive: boolean;
  isPlaying: boolean;
  onPlayOverride?: () => void;
  playSource?: PlaySource;
  queueTracks?: TrackRowData[];
  track: TrackRowData;
}) {
  const { t } = useTranslation();
  const { play, playAll, pause, resume } = usePlayerActions();
  const [resolvingRemote, setResolvingRemote] = useState(false);

  async function handleRemotePlayback() {
    if (resolvingRemote) return;
    setResolvingRemote(true);
    try {
      const resolved = await resolveRemotePlayableTrack(playerTrack);
      play(resolved);
    } catch {
      notify.error(t("search.tryAgain"));
    } finally {
      setResolvingRemote(false);
    }
  }

  async function handleActivate() {
    await activateTrack({
      disabled,
      isActive,
      isPlaying,
      onPlayOverride,
      onRemotePlayback: handleRemotePlayback,
      pause,
      play,
      playAll,
      playerTrack,
      playSource,
      queueTracks,
      resume,
      track,
    });
  }

  return {
    handleActivate,
    playControlLabel: t(
      resolvingRemote
        ? "trackRow.resolvingLabel"
        : isActive && isPlaying
          ? "trackRow.pauseLabel"
          : "trackRow.playLabel",
      { title: track.title || t("trackRow.unknownTitle") },
    ),
    resolvingRemote,
  };
}
