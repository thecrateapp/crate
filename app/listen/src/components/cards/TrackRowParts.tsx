import {
  TrackRowPlaybackControl,
  TrackRowPlaybackProgressView,
} from "./TrackRowPlaybackControl";
import { useEffect, useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { CRATE_ICON_SIZE, Disc3 } from "@crate/ui/icons";
import {
  ItemActionMenu,
  ItemActionMenuButton,
  type ItemActionMenuEntry,
  type UseItemActionMenuReturn,
} from "@/components/actions/ItemActionMenu";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { useTrackPlaylistActions } from "@/hooks/use-track-playlist-actions";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { TrackCoverThumb } from "@/components/artwork/TrackCoverThumb";
import { usePlayerProgress } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { isOfflineBusy, type OfflineItemState } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import type {
  TrackRowData,
  TrackRowProps,
} from "@/components/cards/TrackRowModel";

// Subscribe only in the active visual leaf, never in a row or list.
function TrackRowPlaybackProgress({ isPlaying }: { isPlaying: boolean }) {
  const { currentTime, duration } = usePlayerProgress();
  return (
    <TrackRowPlaybackProgressView
      isPlaying={isPlaying}
      currentTime={currentTime}
      duration={duration}
    />
  );
}

export function TrackRowLeadingControl({
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
  compact?: boolean;
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
  return (
    <TrackRowPlaybackControl
      disabled={disabled}
      index={index ?? trackNumber ?? "—"}
      isActive={isActive}
      isPlaying={isPlaying}
      activeGlyph={
        isActive ? (
          <TrackRowPlaybackProgress isPlaying={isPlaying} />
        ) : undefined
      }
      label={playControlLabel}
      onClick={onClick}
      artwork={
        showCoverThumb ? (
          <TrackCoverThumb
            src={cover}
            iconSize={CRATE_ICON_SIZE.md}
            className="absolute inset-0 rounded-md"
          />
        ) : undefined
      }
    />
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
    <button
      type="button"
      className="max-w-full truncate border-0 p-0 text-left align-bottom link-meta link-inset"
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
    </button>
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
    <button
      type="button"
      className="max-w-full truncate border-0 p-0 text-left align-bottom link-meta link-inset"
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
    </button>
  );
}

function trackRowOfflineClass(state: OfflineItemState): string | undefined {
  if (state === "ready") return "track-row-offline-ready";
  if (isOfflineBusy(state)) return "track-row-offline-busy";
  if (state === "error") return "track-row-offline-error";
  return undefined;
}

export function TrackRowDetails({
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
    <div className="crate-track-details text-text-muted truncate text-xs">
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

export function TrackRowLikeControl({
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
  const { t } = useTranslation();
  if (!hasTrackRef) return <div className=" size-9 shrink-0" />;

  return (
    <FollowHeartButton
      className={` crate-track-action size-9 shrink-0 rounded-full transition-opacity before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:content-[''] ${
        liked
          ? "opacity-100"
          : "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 focus-visible:opacity-100"
      }`}
      title={t(liked ? "actions.track.unlike" : "actions.track.like")}
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

const LINK_ACTION_KEYS = new Set(["share", "artist", "album"]);

function withoutLocalActions(entries: ItemActionMenuEntry[]) {
  return entries.filter(
    (entry) => entry.type !== "divider" && LINK_ACTION_KEYS.has(entry.key),
  );
}

function TrackRowMenu({
  actionMenu,
  cover,
  extraActions,
  onActionMenuOpen,
  onAddToPlaylist,
  onCreatePlaylist,
  onPlayOverride,
  playlistOptions,
  showLocalActions,
  track,
}: {
  actionMenu: UseItemActionMenuReturn;
  cover?: string;
  extraActions?: ItemActionMenuEntry[];
  onActionMenuOpen?: () => void;
  onAddToPlaylist?: TrackRowProps["onAddToPlaylist"];
  onCreatePlaylist?: TrackRowProps["onCreatePlaylist"];
  onPlayOverride?: () => void;
  playlistOptions?: TrackRowProps["playlistOptions"];
  showLocalActions: boolean;
  track: TrackRowData;
}) {
  const { t } = useTranslation();
  const defaultPlaylistActions = useTrackPlaylistActions();
  const usesDefaultPlaylists = playlistOptions === undefined;
  const { ensurePlaylistOptionsLoaded } = defaultPlaylistActions;
  const entries = useTrackActionEntries({
    track,
    albumCover: cover,
    playlistOptions: playlistOptions ?? defaultPlaylistActions.playlistOptions,
    playlistPickerOpen: defaultPlaylistActions.playlistPickerOpen,
    onTogglePlaylistPicker: defaultPlaylistActions.onTogglePlaylistPicker,
    onAddToPlaylist: onAddToPlaylist ?? defaultPlaylistActions.onAddToPlaylist,
    onCreatePlaylist:
      onCreatePlaylist ?? defaultPlaylistActions.onCreatePlaylist,
    onPlayNowOverride: onPlayOverride,
  });
  const actions = useMemo(() => {
    const base = showLocalActions ? entries : withoutLocalActions(entries);
    if (!extraActions?.length) return base;
    return [
      ...base,
      { type: "divider" as const, key: "divider-extra-actions" },
      ...extraActions,
    ];
  }, [entries, extraActions, showLocalActions]);

  useEffect(() => {
    if (showLocalActions && usesDefaultPlaylists) ensurePlaylistOptionsLoaded();
  }, [ensurePlaylistOptionsLoaded, showLocalActions, usesDefaultPlaylists]);

  useEffect(() => {
    onActionMenuOpen?.();
  }, [onActionMenuOpen]);

  return (
    <ItemActionMenu
      actions={actions}
      header={{
        type: "media",
        title: track.title,
        subtitle: track.artist,
        detail: track.album,
        imageUrl: cover,
        imageAlt: track.album
          ? t("trackRow.coverAlt", { title: track.title })
          : track.title,
        imageShape: "square",
        fallbackIcon: Disc3,
      }}
      open={actionMenu.open}
      position={actionMenu.position}
      menuRef={actionMenu.menuRef}
      onClose={actionMenu.close}
    />
  );
}

export function TrackRowActions({
  actionMenu,
  compact,
  cover,
  extraActions,
  onActionMenuOpen,
  onAddToPlaylist,
  onCreatePlaylist,
  onPlayOverride,
  onSelectionActionMenuOpen,
  playlistOptions,
  selectable,
  selected,
  showLocalActions,
  track,
}: {
  actionMenu: UseItemActionMenuReturn;
  compact: boolean;
  cover?: string;
  extraActions?: ItemActionMenuEntry[];
  onActionMenuOpen?: () => void;
  onAddToPlaylist?: TrackRowProps["onAddToPlaylist"];
  onCreatePlaylist?: TrackRowProps["onCreatePlaylist"];
  onPlayOverride?: () => void;
  onSelectionActionMenuOpen?: TrackRowProps["onSelectionActionMenuOpen"];
  playlistOptions?: TrackRowProps["playlistOptions"];
  selectable: boolean;
  selected: boolean;
  showLocalActions: boolean;
  track: TrackRowData;
}) {
  const { t } = useTranslation();
  if (!actionMenu.hasActions) {
    return <div className={cn("shrink-0", compact ? "size-8" : "size-9")} />;
  }

  return (
    <>
      <div className="flex shrink-0 gap-[var(--content-row-inline-gap)] opacity-100 transition-opacity md:opacity-65 md:group-hover:opacity-100">
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
            actionMenu.openFromTrigger(event);
          }}
          onContextMenu={actionMenu.handleContextMenu}
          expanded={actionMenu.open}
          title={t("actions.menu.more")}
          className={cn("crate-track-action", compact ? "size-8" : "size-9")}
        />
      </div>
      {actionMenu.open ? (
        <TrackRowMenu
          actionMenu={actionMenu}
          cover={cover}
          extraActions={extraActions}
          onActionMenuOpen={onActionMenuOpen}
          onAddToPlaylist={onAddToPlaylist}
          onCreatePlaylist={onCreatePlaylist}
          onPlayOverride={onPlayOverride}
          playlistOptions={playlistOptions}
          showLocalActions={showLocalActions}
          track={track}
        />
      ) : null}
    </>
  );
}
