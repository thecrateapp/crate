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
import { getOfflineStateLabel, isOfflineBusy } from "@/lib/offline";
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
  const { t } = useTranslation();
  const { isPlaying } = usePlayerState();
  const { currentTrack, play, playAll, pause, resume } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();
  const { getTrackState } = useOffline();
  const [resolvingRemote, setResolvingRemote] = useState(false);
  const hasTrackRef = hasPlayableTrackReference(track);
  const globalArtistUid = track.global_artist_uid;
  const globalAlbumUid = track.global_album_uid;
  const cover =
    albumCover ||
    (globalAlbumUid
      ? albumCoverApiUrl(
          {
            globalAlbumUid,
          },
          { size: 128 },
        )
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

  const playerTrack: Track = toPlayableTrack(track, { cover });
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
  const liked = hasTrackRef
    ? isLiked(
        track.library_track_id ??
          (typeof track.id === "number" ? track.id : null),
        track.entity_uid,
        track.path,
        track.global_track_uid,
      )
    : false;
  const offlineState = showLocalActions
    ? getTrackState(track.entity_uid)
    : "idle";
  const offlineLabel = showLocalActions
    ? getOfflineStateLabel(offlineState)
    : "";
  const playbackId = resolvePlayableTrackId(track);
  const isActive = currentTrack?.id === playbackId;
  const actions = useTrackActionEntries({
    track,
    albumCover: cover,
    playlistOptions,
    onAddToPlaylist,
    onCreatePlaylist,
    onPlayNowOverride: onPlayOverride,
  });
  const actionMenu = useItemActionMenu(actions, {
    placement: "bottom-end",
  });

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
    if (disabled) return;
    if (isActive) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
      return;
    }
    if (onPlayOverride) {
      await onPlayOverride();
      return;
    }
    if (isRemote) {
      await handleRemotePlayback();
      return;
    }
    if (queueTracks && queueTracks.length > 1) {
      const myId = resolvePlayableTrackId(track);
      const idx = queueTracks.findIndex((t) => {
        return resolvePlayableTrackId(t) === myId;
      });
      playAll(
        queueTracks.map((t) => buildTrackMenuPlayerTrack(t)),
        Math.max(0, idx),
      );
      return;
    }
    play(playerTrack);
  }

  const playControlLabel = `${
    resolvingRemote ? "Resolving" : isActive && isPlaying ? "Pause" : "Play"
  } ${track.title || "track"}`;

  function handlePlayControlClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    void handleActivate();
  }

  return (
    <div
      className={cn(
        "group track-row flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
      )}
      data-active={isActive}
      data-disabled={disabled}
      data-selected={selected}
      aria-selected={selectable ? selected : undefined}
      onContextMenu={(event) => {
        if (disabled) return;
        if (!showLocalActions) return;
        onActionMenuOpen?.();
        actionMenu.handleContextMenu(event);
      }}
      onClick={(event) => {
        if (disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event);
          return;
        }
        void handleActivate();
      }}
      onDoubleClick={
        selectable
          ? (event) => {
              event.preventDefault();
              void handleActivate();
            }
          : undefined
      }
    >
      {showCoverThumb ? (
        <button
          type="button"
          className="relative h-12 w-12 flex-shrink-0 rounded-md border-0 bg-transparent p-0 text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/45 disabled:cursor-not-allowed"
          aria-label={playControlLabel}
          title={playControlLabel}
          disabled={disabled}
          onClick={handlePlayControlClick}
        >
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
        </button>
      ) : (
        <button
          type="button"
          className="flex w-10 flex-shrink-0 justify-center rounded-full border-0 bg-transparent p-0 text-center text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/45 disabled:cursor-not-allowed"
          aria-label={playControlLabel}
          title={playControlLabel}
          disabled={disabled}
          onClick={handlePlayControlClick}
        >
          {disabled ? (
            <span className="text-text-muted text-xs">
              {index != null ? index : track.track_number || "-"}
            </span>
          ) : isActive ? (
            <TrackRowPlaybackProgress isPlaying={isPlaying} />
          ) : (
            <>
              <span className="text-text-muted text-xs md:group-hover:hidden">
                {index != null ? index : track.track_number || "-"}
              </span>
              <Play
                size={CRATE_ICON_SIZE.sm}
                className="text-text-primary mx-auto hidden md:group-hover:block"
              />
            </>
          )}
        </button>
      )}

      {/* Title + optional artist/album */}
      <div className="flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={`min-w-0 truncate text-sm ${
              isActive ? "text-accent-action font-medium" : "text-text-primary"
            }`}
          >
            {track.title || "Unknown"}
          </div>
          {!isRemote ? (
            <OfflineBadge
              state={offlineState}
              compact
              subtle
              className="flex-shrink-0"
            />
          ) : null}
          {disabled ? (
            <span className="track-row-disabled-badge flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
              Soon
            </span>
          ) : null}
        </div>
        {(showArtist || showAlbum || offlineLabel) && (
          <div className="text-text-muted truncate text-xs">
            {showArtist &&
              (globalArtistUid || track.artist_id ? (
                <span
                  className="text-text-muted hover:text-text-primary cursor-pointer transition-colors hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(
                      globalArtistUid
                        ? artistPagePath({
                            artistId: track.artist_id,
                            artistEntityUid: track.artist_entity_uid,
                            globalArtistUid,
                            artistSlug: track.artist_slug,
                            artistName: track.artist,
                          })
                        : artistPagePath({
                            artistId: track.artist_id,
                            artistSlug: track.artist_slug,
                            artistName: track.artist,
                          }),
                    );
                  }}
                >
                  {track.artist}
                </span>
              ) : (
                track.artist
              ))}
            {showArtist && showAlbum && " · "}
            {showAlbum &&
              (globalAlbumUid || track.album_id ? (
                <span
                  className="text-text-muted hover:text-text-primary cursor-pointer transition-colors hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(
                      globalAlbumUid
                        ? albumPagePath({
                            albumId: track.album_id,
                            albumEntityUid: track.album_entity_uid,
                            globalAlbumUid,
                            albumSlug: track.album_slug,
                            artistEntityUid: track.artist_entity_uid,
                            artistName: track.artist,
                            albumName: track.album,
                          })
                        : albumPagePath({
                            albumId: track.album_id,
                            albumSlug: track.album_slug,
                            artistName: track.artist,
                            albumName: track.album,
                          }),
                    );
                  }}
                >
                  {track.album}
                </span>
              ) : (
                track.album
              ))}
            {(showArtist || showAlbum) && offlineLabel && " · "}
            {offlineLabel ? (
              <span
                className={cn(
                  offlineState === "ready"
                    ? "track-row-offline-ready"
                    : isOfflineBusy(offlineState)
                      ? "track-row-offline-busy"
                      : offlineState === "error"
                        ? "track-row-offline-error"
                        : undefined,
                )}
              >
                {offlineLabel}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Duration */}
      {track.duration != null && track.duration > 0 && (
        <span className="text-text-muted flex-shrink-0 text-xs tabular-nums">
          {formatDuration(track.duration)}
        </span>
      )}

      {/* Like + Actions */}
      {hasTrackRef ? (
        <FollowHeartButton
          className={`h-9 w-9 flex-shrink-0 rounded-full transition-opacity ${
            liked ? "opacity-100" : "md:opacity-0 md:group-hover:opacity-100"
          }`}
          title={liked ? "Unlike" : "Like"}
          following={liked}
          heartTestId="track-like-heart"
          particlesTestId="track-like-particles"
          onClick={async (e) => {
            e.stopPropagation();
            const path = track.path || "";
            const trackEntityUid = track.entity_uid ?? null;
            const libraryTrackId =
              track.library_track_id ??
              (typeof track.id === "number" ? track.id : undefined);
            if (!hasTrackRef) return;
            try {
              await toggleTrackLike(
                libraryTrackId ?? null,
                trackEntityUid,
                path,
                track.global_track_uid,
              );
            } catch {
              // Keep row interaction non-blocking; caller surfaces persistence elsewhere.
            }
          }}
          iconSize={CRATE_ICON_SIZE.md}
        />
      ) : (
        <div className="h-9 w-9 flex-shrink-0" />
      )}

      {showLocalActions && !disabled ? (
        <div className="flex-shrink-0 flex gap-1 opacity-100 md:opacity-65 md:group-hover:opacity-100 transition-opacity">
          <ItemActionMenuButton
            buttonRef={actionMenu.triggerRef}
            hasActions={actionMenu.hasActions}
            onClick={(event) => {
              if (
                selectable &&
                selected &&
                onSelectionActionMenuOpen?.(track, event)
              )
                return;
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
      ) : (
        <div className="h-9 w-9 flex-shrink-0" />
      )}
      {showLocalActions && !disabled ? (
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
      ) : null}
    </div>
  );
});
