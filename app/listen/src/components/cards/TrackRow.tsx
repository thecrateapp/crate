import { memo, useId, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import {
  CRATE_ICON_SIZE,
  Disc3,
  Play,
  Pause,
  Heart,
  HeartBold,
} from "@crate/ui/icons";
import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@crate/ui/domain/actions";
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
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { TrackCoverThumb } from "@crate/ui/domain/cards/TrackCoverThumb";
import { getOfflineStateLabel, isOfflineBusy } from "@/lib/offline";
import { cn, formatDuration } from "@/lib/utils";
import {
  albumCoverApiUrl,
  artistPagePath,
  albumPagePath,
} from "@/lib/library-routes";

export interface TrackRowData {
  id?: string | number;
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
  onSelectionContextMenu?: (
    track: TrackRowData,
    event: MouseEvent<HTMLDivElement>,
  ) => boolean | void;
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
      className="group/track-progress relative isolate flex h-10 w-10 items-center justify-center overflow-visible rounded-full bg-black/62 text-white shadow-[0_8px_22px_rgba(0,0,0,0.4),0_0_12px_rgba(34,211,238,0.2),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md"
      data-testid="track-row-playback-progress"
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -inset-[13px] z-0 origin-[46%_57%] rounded-[45%_55%_49%_51%/53%_47%_56%_44%] bg-[radial-gradient(ellipse_58%_46%_at_46%_57%,rgba(34,211,238,0.38)_0%,rgba(34,211,238,0.22)_24%,rgba(34,211,238,0.09)_42%,transparent_64%),radial-gradient(ellipse_38%_32%_at_68%_34%,rgba(165,243,252,0.22)_0%,rgba(165,243,252,0.09)_34%,transparent_66%),radial-gradient(ellipse_34%_42%_at_30%_66%,rgba(8,145,178,0.25)_0%,rgba(8,145,178,0.09)_38%,transparent_68%)] opacity-[0.64] blur-[1px]",
          isPlaying && "animate-crate-play-aura-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-[4px] z-10 rounded-full bg-[radial-gradient(circle_at_48%_42%,rgba(207,250,254,0.18)_0%,rgba(34,211,238,0.16)_28%,rgba(6,182,212,0.08)_54%,transparent_74%)] opacity-70",
          isPlaying && "animate-crate-play-rim-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-[2px] z-20 rounded-full bg-[#121326] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_-10px_24px_rgba(0,0,0,0.48)]",
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
            <stop offset="0%" stopColor="rgba(207,250,254,0.98)" />
            <stop offset="48%" stopColor="rgba(34,211,238,0.96)" />
            <stop offset="100%" stopColor="rgba(6,182,212,0.72)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
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
          className="transition-[stroke-dashoffset] duration-300 ease-linear"
          style={{
            filter:
              "drop-shadow(0 0 5px rgba(34,211,238,0.84)) drop-shadow(0 0 12px rgba(6,182,212,0.42))",
          }}
        />
      </svg>
      {isPlaying ? (
        <Pause
          size={CRATE_ICON_SIZE.sm}
          className="relative z-40 drop-shadow-[0_0_4px_rgba(255,255,255,0.35)]"
          fill="currentColor"
        />
      ) : (
        <Play
          size={CRATE_ICON_SIZE.sm}
          className="relative z-40 ml-0.5 drop-shadow-[0_0_4px_rgba(255,255,255,0.35)]"
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
  onSelectionContextMenu,
  onSelectionActionMenuOpen,
  queueTracks,
}: TrackRowProps) {
  const navigate = useNavigate();
  const { isPlaying } = usePlayerState();
  const { currentTrack, play, playAll, pause, resume } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();
  const { getTrackState } = useOffline();
  const hasTrackRef = hasPlayableTrackReference(track);
  const disabled = Boolean(track.disabled);

  const liked = isLiked(
    track.library_track_id ?? (typeof track.id === "number" ? track.id : null),
    track.entity_uid,
    track.path,
  );
  const offlineState = getTrackState(track.entity_uid);
  const offlineLabel = getOfflineStateLabel(offlineState);
  const cover =
    albumCover ||
    (track.album_id != null
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
  const actionMenu = useItemActionMenu(actions);

  function handleActivate() {
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
      onPlayOverride();
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

  const playControlLabel = `${isActive && isPlaying ? "Pause" : "Play"} ${
    track.title || "track"
  }`;

  function handlePlayControlClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    handleActivate();
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors cursor-pointer",
        disabled
          ? "cursor-not-allowed opacity-55"
          : selected
            ? "bg-primary/12 ring-1 ring-primary/30"
            : isActive
              ? "bg-primary/10"
              : "hover:bg-white/5",
      )}
      aria-selected={selectable ? selected : undefined}
      onContextMenu={(event) => {
        if (disabled) return;
        if (selectable && onSelectionContextMenu?.(track, event)) return;
        onActionMenuOpen?.();
        actionMenu.handleContextMenu(event);
      }}
      onClick={(event) => {
        if (disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event);
          return;
        }
        handleActivate();
      }}
      onDoubleClick={
        selectable
          ? (event) => {
              event.preventDefault();
              handleActivate();
            }
          : undefined
      }
    >
      {showCoverThumb ? (
        <button
          type="button"
          className="relative h-12 w-12 flex-shrink-0 rounded-md border-0 bg-transparent p-0 text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:cursor-not-allowed"
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
          <div
            className={`absolute inset-0 flex items-center justify-center rounded-md transition-colors ${
              isActive ? "bg-black/40" : "bg-black/0 group-hover:bg-black/45"
            }`}
          >
            {disabled ? null : isActive ? (
              <TrackRowPlaybackProgress isPlaying={isPlaying} />
            ) : (
              <Play
                size={CRATE_ICON_SIZE.md}
                className={`text-white transition-opacity ${
                  isActive
                    ? "opacity-100"
                    : "opacity-0 md:group-hover:opacity-100"
                }`}
                fill="currentColor"
              />
            )}
          </div>
        </button>
      ) : (
        <button
          type="button"
          className="flex w-10 flex-shrink-0 justify-center rounded-full border-0 bg-transparent p-0 text-center text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:cursor-not-allowed"
          aria-label={playControlLabel}
          title={playControlLabel}
          disabled={disabled}
          onClick={handlePlayControlClick}
        >
          {disabled ? (
            <span className="text-xs text-muted-foreground">
              {index != null ? index : track.track_number || "-"}
            </span>
          ) : isActive ? (
            <TrackRowPlaybackProgress isPlaying={isPlaying} />
          ) : (
            <>
              <span className="text-xs text-muted-foreground md:group-hover:hidden">
                {index != null ? index : track.track_number || "-"}
              </span>
              <Play
                size={CRATE_ICON_SIZE.sm}
                className="text-foreground mx-auto hidden md:group-hover:block"
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
              isActive ? "text-primary font-medium" : "text-foreground"
            }`}
          >
            {track.title || "Unknown"}
          </div>
          <OfflineBadge
            state={offlineState}
            compact
            subtle
            className="flex-shrink-0"
          />
          {disabled ? (
            <span className="flex-shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/45">
              Soon
            </span>
          ) : null}
        </div>
        {(showArtist || showAlbum || offlineLabel) && (
          <div className="text-xs text-muted-foreground truncate">
            {showArtist &&
              (track.artist_id ? (
                <span
                  className="hover:text-foreground hover:underline transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(
                      artistPagePath({
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
              (track.album_id ? (
                <span
                  className="hover:text-foreground hover:underline transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(
                      albumPagePath({
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
                    ? "text-cyan-300/75"
                    : isOfflineBusy(offlineState)
                      ? "text-primary/80"
                      : offlineState === "error"
                        ? "text-amber-300/80"
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
        <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
          {formatDuration(track.duration)}
        </span>
      )}

      {/* Like + Actions */}
      {!disabled ? (
        <ActionIconButton
          variant="row"
          active={liked}
          className={`h-9 w-9 flex-shrink-0 transition-opacity ${
            liked ? "opacity-100" : "md:opacity-0 md:group-hover:opacity-100"
          }`}
          title={liked ? "Unlike" : "Like"}
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
              );
            } catch {
              // Keep row interaction non-blocking; caller surfaces persistence elsewhere.
            }
          }}
        >
          {liked ? (
            <HeartBold
              size={CRATE_ICON_SIZE.md}
              className="animate-crate-icon-active-pulse"
            />
          ) : (
            <Heart size={CRATE_ICON_SIZE.md} />
          )}
        </ActionIconButton>
      ) : (
        <div className="h-9 w-9 flex-shrink-0" />
      )}

      {!disabled ? (
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
      {!disabled ? (
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
