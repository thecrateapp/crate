import { memo, useId, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Disc3, Play, Pause } from "@crate/ui/icons";
import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { buildTrackMenuPlayerTrack } from "@/components/actions/shared";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { useOffline } from "@/contexts/OfflineContext";
import {
  usePlayerState,
  usePlayerActions,
  usePlayerProgress,
  type Track,
} from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import {
  hasPlayableTrackReference,
  resolvePlayableTrackId,
  toPlayableTrack,
} from "@/lib/playable-track";
import { resolveRemotePlayableTrack } from "@/lib/remote-track-playback";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { TrackCoverThumb } from "@/components/artwork/TrackCoverThumb";
import {
  getOfflineStateLabel,
  isOfflineBusy,
  type OfflineItemState,
} from "@/lib/offline";
import { cn, formatDuration } from "@/lib/utils";
import { toast } from "sonner";
import {
  albumCoverApiUrl,
  artistPagePath,
  albumPagePath,
} from "@/lib/library-routes";

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

interface TrackRowProps {
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
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (track: TrackRowData, event: MouseEvent<HTMLDivElement>) => void;
  onSelectionActionMenuOpen?: (
    track: TrackRowData,
    event: MouseEvent<HTMLButtonElement>,
  ) => boolean | void;
  /** Pass the full sibling track list so clicking plays all from this track's position. */
  queueTracks?: TrackRowData[];
}

type TrackRowResolvedState = {
  cover?: string;
  playerTrack: Track;
  isRemote: boolean;
  isGlobalCatalogOnly: boolean;
  showLocalActions: boolean;
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

  return {
    cover,
    playerTrack,
    isRemote,
    isGlobalCatalogOnly,
    showLocalActions,
    disabled,
    playbackId: resolvePlayableTrackId(track),
  };
}

function useTrackRowModel({
  track,
  albumCover,
  playlistOptions,
  onAddToPlaylist,
  onCreatePlaylist,
  onPlayOverride,
}: Pick<
  TrackRowProps,
  | "track"
  | "albumCover"
  | "playlistOptions"
  | "onAddToPlaylist"
  | "onCreatePlaylist"
  | "onPlayOverride"
>) {
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
  const actions = useTrackActionEntries({
    track,
    albumCover: resolved.cover,
    playlistOptions,
    onAddToPlaylist,
    onCreatePlaylist,
    onPlayNowOverride: onPlayOverride,
  });
  const actionMenu = useItemActionMenu(actions, {
    placement: "bottom-end",
  });

  return {
    ...resolved,
    actionMenu,
    actions,
    hasTrackRef,
    liked,
    offlineLabel,
    offlineState,
  };
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
  playAll: (tracks: Track[], index?: number) => void;
  playerTrack: Track;
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
    const myId = resolvePlayableTrackId(track);
    const idx = queueTracks.findIndex(
      (queueTrack) => resolvePlayableTrackId(queueTrack) === myId,
    );
    playAll(
      queueTracks.map((queueTrack) => buildTrackMenuPlayerTrack(queueTrack)),
      Math.max(0, idx),
    );
    return;
  }
  play(playerTrack);
}

function useTrackRowPlayback({
  disabled,
  isActive,
  isPlaying,
  onPlayOverride,
  playerTrack,
  queueTracks,
  track,
}: Pick<TrackRowResolvedState, "disabled" | "playerTrack"> & {
  isActive: boolean;
  isPlaying: boolean;
  onPlayOverride?: () => void;
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
      toast.error(t("search.tryAgain"));
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
      queueTracks,
      resume,
      track,
    });
  }

  return {
    handleActivate,
    playControlLabel: `${
      resolvingRemote ? "Resolving" : isActive && isPlaying ? "Pause" : "Play"
    } ${track.title || "track"}`,
    resolvingRemote,
  };
}

function TrackRowPlaybackProgress({ isPlaying }: { isPlaying: boolean }) {
  const { currentTime, duration } = usePlayerProgress();
  const gradientId = useId().replace(/:/g, "");
  const size = 38;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress =
    Number.isFinite(duration) && duration > 0
      ? Math.max(0, Math.min(1, currentTime / duration))
      : 0;

  return (
    <span
      className="group/track-progress track-row-playback-progress relative isolate flex h-10 w-10 items-center justify-center overflow-visible rounded-full backdrop-blur-md"
      data-testid="track-row-playback-progress"
    >
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-aura pointer-events-none absolute -inset-[13px] z-0 origin-[46%_57%] rounded-[45%_55%_49%_51%/53%_47%_56%_44%] opacity-[0.64] blur-[1px]",
          isPlaying && "animate-crate-play-aura-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-rim pointer-events-none absolute inset-[4px] z-10 rounded-full opacity-70",
          isPlaying && "animate-crate-play-rim-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-core pointer-events-none absolute inset-[2px] z-20 rounded-full",
          isPlaying && "animate-crate-play-core-pulse",
        )}
      />
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-[1px] z-30 h-[calc(100%-2px)] w-[calc(100%-2px)] -rotate-90 overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className="track-row-playback-gradient-start" />
            <stop offset="48%" className="track-row-playback-gradient-mid" />
            <stop offset="100%" className="track-row-playback-gradient-end" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="track-row-playback-track"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          strokeWidth={stroke}
          className="track-row-playback-ring transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      {isPlaying ? (
        <Pause
          size={CRATE_ICON_SIZE.sm}
          className="track-row-playback-icon relative z-40"
          fill="currentColor"
        />
      ) : (
        <Play
          size={CRATE_ICON_SIZE.sm}
          className="track-row-playback-icon relative z-40 ml-0.5"
          fill="currentColor"
        />
      )}
    </span>
  );
}

function TrackRowLeadingControl({
  cover,
  disabled,
  index,
  isActive,
  isPlaying,
  playControlLabel,
  showCoverThumb,
  trackNumber,
  onClick,
}: {
  cover?: string;
  disabled: boolean;
  index?: number;
  isActive: boolean;
  isPlaying: boolean;
  playControlLabel: string;
  showCoverThumb: boolean;
  trackNumber?: number;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const trackIndex = index != null ? index : trackNumber || "-";
  const playIcon = isActive ? (
    <TrackRowPlaybackProgress isPlaying={isPlaying} />
  ) : (
    <Play
      size={CRATE_ICON_SIZE.sm}
      className="text-text-primary mx-auto hidden md:group-hover:block"
    />
  );

  return (
    <button
      type="button"
      className={cn(
        showCoverThumb
          ? "relative h-12 w-12 flex-shrink-0 rounded-md border-0 bg-transparent p-0 text-inherit"
          : "flex w-10 flex-shrink-0 justify-center rounded-full border-0 bg-transparent p-0 text-center text-inherit",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/45 disabled:cursor-not-allowed",
      )}
      aria-label={playControlLabel}
      title={playControlLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {showCoverThumb ? (
        <>
          <TrackCoverThumb
            src={cover}
            iconSize={CRATE_ICON_SIZE.md}
            className="absolute inset-0 rounded-md"
          />
          <div className="track-row-cover-overlay absolute inset-0 flex items-center justify-center rounded-md transition-colors">
            {disabled ? null : isActive ? (
              <TrackRowPlaybackProgress isPlaying={isPlaying} />
            ) : (
              <Play
                size={CRATE_ICON_SIZE.md}
                className="track-row-cover-play-icon"
                fill="currentColor"
              />
            )}
          </div>
        </>
      ) : disabled ? (
        <span className="text-text-muted text-xs">{trackIndex}</span>
      ) : (
        <>
          <span className="text-text-muted text-xs md:group-hover:hidden">
            {trackIndex}
          </span>
          {playIcon}
        </>
      )}
    </button>
  );
}

function TrackRowArtistLink({
  globalArtistUid,
  navigate,
  track,
}: {
  globalArtistUid?: string;
  navigate: ReturnType<typeof useNavigate>;
  track: TrackRowData;
}) {
  if (!globalArtistUid && !track.artist_id) return <>{track.artist}</>;

  return (
    <span
      className="text-text-muted hover:text-text-primary cursor-pointer transition-colors hover:underline"
      onClick={(event) => {
        event.stopPropagation();
        navigate(
          artistPagePath({
            artistId: track.artist_id,
            artistEntityUid: globalArtistUid
              ? track.artist_entity_uid
              : undefined,
            globalArtistUid,
            artistSlug: track.artist_slug,
            artistName: track.artist,
          }),
        );
      }}
    >
      {track.artist}
    </span>
  );
}

function TrackRowAlbumLink({
  globalAlbumUid,
  navigate,
  track,
}: {
  globalAlbumUid?: string;
  navigate: ReturnType<typeof useNavigate>;
  track: TrackRowData;
}) {
  if (!globalAlbumUid && !track.album_id) return <>{track.album}</>;

  return (
    <span
      className="text-text-muted hover:text-text-primary cursor-pointer transition-colors hover:underline"
      onClick={(event) => {
        event.stopPropagation();
        navigate(
          albumPagePath({
            albumId: track.album_id,
            albumEntityUid: globalAlbumUid ? track.album_entity_uid : undefined,
            globalAlbumUid,
            albumSlug: track.album_slug,
            artistEntityUid: track.artist_entity_uid,
            artistName: track.artist,
            albumName: track.album,
          }),
        );
      }}
    >
      {track.album}
    </span>
  );
}

function trackRowOfflineClass(state: OfflineItemState): string | undefined {
  if (state === "ready") return "track-row-offline-ready";
  if (isOfflineBusy(state)) return "track-row-offline-busy";
  if (state === "error") return "track-row-offline-error";
  return undefined;
}

function TrackRowDetails({
  globalAlbumUid,
  globalArtistUid,
  navigate,
  offlineLabel,
  offlineState,
  showAlbum,
  showArtist,
  track,
}: {
  globalAlbumUid?: string;
  globalArtistUid?: string;
  navigate: ReturnType<typeof useNavigate>;
  offlineLabel: string | null;
  offlineState: OfflineItemState;
  showAlbum: boolean;
  showArtist: boolean;
  track: TrackRowData;
}) {
  if (!showArtist && !showAlbum && !offlineLabel) return null;

  return (
    <div className="text-text-muted truncate text-xs">
      {showArtist ? (
        <TrackRowArtistLink
          globalArtistUid={globalArtistUid}
          navigate={navigate}
          track={track}
        />
      ) : null}
      {showArtist && showAlbum && " · "}
      {showAlbum ? (
        <TrackRowAlbumLink
          globalAlbumUid={globalAlbumUid}
          navigate={navigate}
          track={track}
        />
      ) : null}
      {(showArtist || showAlbum) && offlineLabel && " · "}
      {offlineLabel ? (
        <span className={trackRowOfflineClass(offlineState)}>
          {offlineLabel}
        </span>
      ) : null}
    </div>
  );
}

function TrackRowLikeControl({
  hasTrackRef,
  liked,
  toggleTrackLike,
  track,
}: {
  hasTrackRef: boolean;
  liked: boolean;
  toggleTrackLike: ReturnType<typeof useLikedTracks>["toggleTrackLike"];
  track: TrackRowData;
}) {
  if (!hasTrackRef) return <div className="h-9 w-9 flex-shrink-0" />;

  return (
    <FollowHeartButton
      className={`h-9 w-9 flex-shrink-0 rounded-full transition-opacity ${
        liked ? "opacity-100" : "md:opacity-0 md:group-hover:opacity-100"
      }`}
      title={liked ? "Unlike" : "Like"}
      following={liked}
      heartTestId="track-like-heart"
      particlesTestId="track-like-particles"
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await toggleTrackLike(
            track.library_track_id ??
              (typeof track.id === "number" ? track.id : undefined),
            track.entity_uid ?? null,
            track.path || "",
            track.global_track_uid,
          );
        } catch {
          // Keep row interaction non-blocking; caller surfaces persistence elsewhere.
        }
      }}
      iconSize={CRATE_ICON_SIZE.md}
    />
  );
}

function TrackRowActions({
  actionMenu,
  actions,
  cover,
  disabled,
  onActionMenuOpen,
  onSelectionActionMenuOpen,
  selectable,
  selected,
  showLocalActions,
  track,
}: {
  actionMenu: ReturnType<typeof useItemActionMenu>;
  actions: ReturnType<typeof useTrackActionEntries>;
  cover?: string;
  disabled: boolean;
  onActionMenuOpen?: () => void;
  onSelectionActionMenuOpen?: (
    track: TrackRowData,
    event: MouseEvent<HTMLButtonElement>,
  ) => boolean | void;
  selectable: boolean;
  selected: boolean;
  showLocalActions: boolean;
  track: TrackRowData;
}) {
  if (!showLocalActions || disabled) {
    return <div className="h-9 w-9 flex-shrink-0" />;
  }

  return (
    <>
      <div className="flex flex-shrink-0 gap-1 opacity-100 transition-opacity md:opacity-65 md:group-hover:opacity-100">
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={(event) => {
            if (
              selectable &&
              selected &&
              onSelectionActionMenuOpen?.(track, event)
            ) {
              return;
            }
            onActionMenuOpen?.();
            actionMenu.openFromTrigger(event);
          }}
          onContextMenu={(event) => {
            onActionMenuOpen?.();
            actionMenu.handleContextMenu(event);
          }}
          className="h-9 w-9"
        />
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: track.title,
          subtitle: track.artist,
          detail: track.album,
          imageUrl: cover,
          imageAlt: track.album ? `${track.title} cover` : track.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </>
  );
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  showArtist = false,
  showAlbum = false,
  albumCover,
  showCoverThumb = false,
  playlistOptions,
  onAddToPlaylist,
  onCreatePlaylist,
  onActionMenuOpen,
  onPlayOverride,
  selectable = false,
  selected = false,
  onSelect,
  onSelectionActionMenuOpen,
  queueTracks,
}: TrackRowProps) {
  const navigate = useNavigate();
  const { isPlaying } = usePlayerState();
  const { currentTrack } = usePlayerActions();
  const { toggleTrackLike } = useLikedTracks();
  const model = useTrackRowModel({
    track,
    albumCover,
    playlistOptions,
    onAddToPlaylist,
    onCreatePlaylist,
    onPlayOverride,
  });
  const isActive = currentTrack?.id === model.playbackId;
  const playback = useTrackRowPlayback({
    disabled: model.disabled,
    isActive,
    isPlaying,
    onPlayOverride,
    playerTrack: model.playerTrack,
    queueTracks,
    track,
  });

  function handlePlayControlClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    void playback.handleActivate();
  }

  return (
    <div
      className={cn(
        "group track-row flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
      )}
      data-active={isActive}
      data-disabled={model.disabled}
      data-selected={selected}
      aria-selected={selectable ? selected : undefined}
      onContextMenu={(event) => {
        if (model.disabled) return;
        if (!model.showLocalActions) return;
        onActionMenuOpen?.();
        model.actionMenu.handleContextMenu(event);
      }}
      onClick={(event) => {
        if (model.disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event);
          return;
        }
        void playback.handleActivate();
      }}
      onDoubleClick={
        selectable
          ? (event) => {
              event.preventDefault();
              void playback.handleActivate();
            }
          : undefined
      }
    >
      <TrackRowLeadingControl
        cover={model.cover}
        disabled={model.disabled}
        index={index}
        isActive={isActive}
        isPlaying={isPlaying}
        playControlLabel={playback.playControlLabel}
        showCoverThumb={showCoverThumb}
        trackNumber={track.track_number}
        onClick={handlePlayControlClick}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "min-w-0 truncate text-sm",
              isActive ? "font-medium text-accent-action" : "text-text-primary",
            )}
          >
            {track.title || "Unknown"}
          </div>
          {!model.isRemote ? (
            <OfflineBadge
              state={model.offlineState}
              compact
              subtle
              className="flex-shrink-0"
            />
          ) : null}
          {model.disabled ? (
            <span className="track-row-disabled-badge flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
              Soon
            </span>
          ) : null}
        </div>
        <TrackRowDetails
          globalAlbumUid={track.global_album_uid}
          globalArtistUid={track.global_artist_uid}
          navigate={navigate}
          offlineLabel={model.offlineLabel}
          offlineState={model.offlineState}
          showAlbum={showAlbum}
          showArtist={showArtist}
          track={track}
        />
      </div>

      {/* Duration */}
      {track.duration != null && track.duration > 0 && (
        <span className="text-text-muted flex-shrink-0 text-xs tabular-nums">
          {formatDuration(track.duration)}
        </span>
      )}

      <TrackRowLikeControl
        hasTrackRef={model.hasTrackRef}
        liked={model.liked}
        toggleTrackLike={toggleTrackLike}
        track={track}
      />
      <TrackRowActions
        actionMenu={model.actionMenu}
        actions={model.actions}
        cover={model.cover}
        disabled={model.disabled}
        onActionMenuOpen={onActionMenuOpen}
        onSelectionActionMenuOpen={onSelectionActionMenuOpen}
        selectable={selectable}
        selected={selected}
        showLocalActions={model.showLocalActions}
        track={track}
      />
    </div>
  );
});
