import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { CRATE_ICON_SIZE, Disc3, Loader2, Play } from "@crate/ui/icons";

import {
  ItemActionMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  albumCoverArtwork,
  artworkFromUrl,
  type ArtworkSource,
} from "@/lib/artwork-source";
import {
  getOfflineStateLabel,
  isOfflineBusy,
  type OfflineItemRecord,
  type OfflineItemState,
} from "@/lib/offline";
import { toPlayableTrack } from "@/lib/playable-track";
import { cn } from "@/lib/utils";
import { albumApiPath, albumPagePath } from "@/lib/library-routes";

interface AlbumCardProps {
  artist: string;
  album: string;
  albumId?: number;
  albumEntityUid?: string;
  globalAlbumUid?: string;
  artistEntityUid?: string;
  albumSlug?: string;
  artistSlug?: string;
  year?: string;
  cover?: string;
  isPreRelease?: boolean;
  releaseDate?: string | null;
  compact?: boolean;
  layout?: "rail" | "grid";
}

interface AlbumData {
  artist: string;
  name: string;
  display_name: string;
  global_album_uid?: string;
  global_artist_uid?: string;
  tracks: Array<{
    id: string | number;
    entity_uid?: string;
    globalTrackUid?: string;
    global_track_uid?: string;
    global_uid?: string;
    filename: string;
    path?: string | null;
    is_available?: boolean;
    length_sec: number;
    tags: {
      title: string;
    };
  }>;
}

function albumOfflineMeta(
  state: OfflineItemState,
  record: OfflineItemRecord | null | undefined,
): string {
  if (state === "ready") {
    return record?.trackCount
      ? `${record.trackCount} offline`
      : getOfflineStateLabel(state) ?? "";
  }
  if (isOfflineBusy(state) && record?.trackCount) {
    return `${Math.min(record.readyTrackCount || 0, record.trackCount)}/${
      record.trackCount
    } offline`;
  }
  return getOfflineStateLabel(state) ?? "";
}

function useAlbumCardPlayback({
  albumRouteInput,
  album,
  albumId,
  artist,
  coverUrl,
  globalAlbumUid,
  playAll,
}: {
  albumRouteInput: Parameters<typeof albumApiPath>[0];
  album: string;
  albumId?: number;
  artist: string;
  coverUrl: string;
  globalAlbumUid?: string;
  playAll: ReturnType<typeof usePlayerActions>["playAll"];
}) {
  const [playing, setPlaying] = useState(false);

  async function handlePlayOverlay(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setPlaying(true);
    try {
      const data = await api<AlbumData>(albumApiPath(albumRouteInput));
      const playerTracks: Track[] = (data.tracks || [])
        .filter((track) => track.is_available !== false)
        .map((track) =>
          toPlayableTrack(
            {
              id: track.id,
              entity_uid: track.entity_uid,
              globalTrackUid:
                track.globalTrackUid ??
                track.global_track_uid ??
                track.global_uid,
              global_artist_uid: data.global_artist_uid,
              global_album_uid:
                data.global_album_uid ?? globalAlbumUid ?? undefined,
              title: track.tags?.title || track.filename || "Unknown",
              artist: data.artist,
              album: data.display_name || data.name,
              path: track.path,
              library_track_id:
                typeof track.id === "number" && track.id > 0
                  ? track.id
                  : undefined,
            },
            { cover: coverUrl },
          ),
        );
      if (playerTracks.length > 0) {
        playAll(playerTracks, 0, {
          type: "album",
          name: `${artist} - ${album}`,
          href: albumPagePath(albumRouteInput),
          radio:
            albumId != null
              ? { seedType: "album", seedId: albumId }
              : undefined,
        });
      }
    } finally {
      setPlaying(false);
    }
  }

  return { playing, handlePlayOverlay };
}

function AlbumCardArtworkSurface({
  coverArtwork,
  coverSizes,
  album,
  offlineState,
  isPreRelease,
}: {
  coverArtwork: ArtworkSource;
  coverSizes: string;
  album: string;
  offlineState: OfflineItemState;
  isPreRelease: boolean;
}) {
  return (
    <ArtworkSurface
      source={{
        ...coverArtwork,
        sizes: coverArtwork.srcSet ? coverSizes : undefined,
      }}
      alt={album}
      className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-text-primary/5"
      fallback={
        <div className="grid h-full w-full place-items-center bg-surface-elevated text-text-primary/35">
          <Disc3 size={CRATE_ICON_SIZE.xl} />
        </div>
      }
      imageProps={{ loading: "lazy", decoding: "async" }}
      imageClassName="object-cover"
    >
      <OfflineBadge
        state={offlineState}
        compact
        className="absolute left-2 top-2 z-10"
      />
      {isPreRelease ? (
        <span className="absolute bottom-2 left-2 z-10 rounded-full border border-accent-action/25 bg-surface-canvas/55 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-accent-action backdrop-blur-sm">
          Pre-release
        </span>
      ) : null}
    </ArtworkSurface>
  );
}

function AlbumCardArtworkControls({
  album,
  albumId,
  globalAlbumUid,
  saved,
  savedLabel,
  onToggleSaved,
  playing,
  onPlayOverlay,
}: {
  album: string;
  albumId?: number;
  globalAlbumUid?: string;
  saved: boolean;
  savedLabel: string;
  onToggleSaved: () => Promise<void>;
  playing: boolean;
  onPlayOverlay: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      {albumId != null || globalAlbumUid ? (
        <FollowHeartButton
          className={`absolute right-2 top-2 z-20 flex h-9 min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--idle-border)] bg-surface-canvas/55 shadow-icon-control backdrop-blur-md transition-[color,filter,transform] hover:-translate-y-px md:min-h-0 md:min-w-0 ${
            saved ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"
          }`}
          following={saved}
          iconSize={CRATE_ICON_SIZE.md}
          aria-label={savedLabel}
          onClick={async (event) => {
            event.stopPropagation();
            try {
              await onToggleSaved();
            } catch {
              // no-op; page-level toasts can be added later
            }
          }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex aspect-square items-center justify-center bg-surface-canvas/0 transition-colors md:group-hover/card:bg-surface-canvas/40">
        <button
          type="button"
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent-action opacity-0 shadow-lg transition-[transform,opacity] md:translate-y-2 md:group-hover/card:translate-y-0 md:group-hover/card:opacity-100"
          onClick={onPlayOverlay}
          aria-label={`Play ${album}`}
        >
          {playing ? (
            <Loader2
              size={CRATE_ICON_SIZE.lg}
              className="animate-spin text-accent-action-foreground"
            />
          ) : (
            <Play
              size={CRATE_ICON_SIZE.lg}
              fill="currentColor"
              className="ml-0.5 text-accent-action-foreground"
            />
          )}
        </button>
      </div>
    </>
  );
}

function AlbumCardDetails({
  album,
  artist,
  year,
  isPreRelease,
  releaseDate,
  offlineMeta,
  offlineState,
}: {
  album: string;
  artist: string;
  year?: string;
  isPreRelease: boolean;
  releaseDate?: string | null;
  offlineMeta: string;
  offlineState: OfflineItemState;
}) {
  return (
    <>
      <div className="truncate text-sm font-medium text-text-primary">
        {album}
      </div>
      <div className="truncate text-xs text-text-muted">
        {isPreRelease && releaseDate
          ? `Releases ${new Date(`${releaseDate}T12:00:00`).toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric" },
            )} · ${artist}`
          : year
            ? `${year} · ${artist}`
            : artist}
        {offlineMeta ? (
          <span
            className={cn(
              "ml-1.5",
              offlineState === "ready"
                ? "text-text-accent/90"
                : isOfflineBusy(offlineState)
                  ? "text-accent-action"
                  : offlineState === "error"
                    ? "text-state-warning-text/90"
                    : undefined,
            )}
          >
            · {offlineMeta}
          </span>
        ) : null}
      </div>
    </>
  );
}

function useAlbumCardModel({
  artist,
  album,
  albumId,
  albumEntityUid,
  globalAlbumUid,
  artistEntityUid,
  albumSlug,
  artistSlug,
  year,
  cover,
  isPreRelease,
  releaseDate,
  compact,
  layout,
}: AlbumCardProps & {
  isPreRelease: boolean;
  layout: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const { isSaved, toggleAlbumSaved } = useSavedAlbums();
  const { getAlbumState, getAlbumRecord } = useOffline();
  const albumRouteInput = {
    albumId,
    albumEntityUid,
    globalAlbumUid,
    artistEntityUid,
    albumSlug,
    artistSlug,
    artistName: artist,
    albumName: album,
  };
  const generatedArtwork = albumCoverArtwork(albumRouteInput, {
    preset: "album-card",
    size: layout === "grid" ? 320 : compact ? 192 : 256,
  });
  const coverArtwork = cover
    ? artworkFromUrl(cover, {
        kind: "album-cover",
        logicalKey: generatedArtwork.logicalKey,
        retryPolicy: "credentials",
      })
    : generatedArtwork;
  const coverUrl = coverArtwork.src ?? "";
  const coverSizes =
    layout === "grid"
      ? "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 17vw"
      : compact
        ? "120px"
        : "160px";
  const saved = isSaved(albumId, globalAlbumUid);
  const offlineState = getAlbumState(albumId);
  const offlineRecord = getAlbumRecord(albumId);
  const offlineMeta = albumOfflineMeta(offlineState, offlineRecord);
  const actions = useAlbumActionEntries({
    artist,
    album,
    albumId,
    albumEntityUid,
    globalAlbumUid,
    artistEntityUid,
    albumSlug,
    cover: coverUrl,
  });
  const actionMenu = useItemActionMenu(actions);
  const menuCoverUrl = actionMenu.open
    ? resolveMaybeApiAssetUrl(coverUrl) || coverUrl
    : null;
  const savedLabel = saved
    ? t("album.actions.removeFromCollection")
    : t("album.actions.addToCollection");

  async function handleToggleSaved() {
    await toggleAlbumSaved(albumId, globalAlbumUid);
  }

  return {
    actions,
    actionMenu,
    albumRouteInput,
    coverArtwork,
    coverSizes,
    coverUrl,
    isPreRelease,
    menuCoverUrl,
    offlineMeta,
    offlineState,
    saved,
    savedLabel,
    handleToggleSaved,
    releaseDate,
    year,
  };
}

export const AlbumCard = memo(function AlbumCard({
  artist,
  album,
  albumId,
  albumEntityUid,
  globalAlbumUid,
  artistEntityUid,
  albumSlug,
  artistSlug,
  year,
  cover,
  isPreRelease = false,
  releaseDate,
  compact,
  layout = "rail",
}: AlbumCardProps) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const model = useAlbumCardModel({
    artist,
    album,
    albumId,
    albumEntityUid,
    globalAlbumUid,
    artistEntityUid,
    albumSlug,
    artistSlug,
    year,
    cover,
    isPreRelease,
    releaseDate,
    compact,
    layout,
  });

  const { playing, handlePlayOverlay } = useAlbumCardPlayback({
    albumRouteInput: model.albumRouteInput,
    album,
    albumId,
    artist,
    coverUrl: model.coverUrl,
    globalAlbumUid,
    playAll,
  });

  return (
    <article
      className={cn(
        "group/card relative snap-start rounded-xl text-left transition-colors",
        layout === "grid"
          ? "listen-deferred-grid-item w-full min-w-0"
          : `flex-shrink-0 ${compact ? "w-[120px]" : "w-[160px]"}`,
      )}
      onContextMenu={model.actionMenu.handleContextMenu}
      {...model.actionMenu.longPressHandlers}
    >
      <button
        type="button"
        className={cn(
          "group block w-full rounded-xl p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          model.offlineState === "ready"
            ? "bg-accent-action/[0.04]"
            : isOfflineBusy(model.offlineState)
              ? "bg-accent-action/[0.05]"
              : model.offlineState === "error"
                ? "bg-state-warning/[0.05]"
                : "hover:bg-text-primary/5",
        )}
        onClick={() => navigate(albumPagePath(model.albumRouteInput))}
        onKeyDown={(event) => {
          model.actionMenu.handleKeyboardTrigger(event);
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate(albumPagePath(model.albumRouteInput));
          }
        }}
      >
        <AlbumCardArtworkSurface
          coverArtwork={model.coverArtwork}
          coverSizes={model.coverSizes}
          album={album}
          offlineState={model.offlineState}
          isPreRelease={model.isPreRelease}
        />
        <AlbumCardDetails
          album={album}
          artist={artist}
          year={year}
          isPreRelease={model.isPreRelease}
          releaseDate={model.releaseDate}
          offlineMeta={model.offlineMeta}
          offlineState={model.offlineState}
        />
      </button>
      <AlbumCardArtworkControls
        album={album}
        albumId={albumId}
        globalAlbumUid={globalAlbumUid}
        saved={model.saved}
        savedLabel={model.savedLabel}
        onToggleSaved={model.handleToggleSaved}
        playing={playing}
        onPlayOverlay={handlePlayOverlay}
      />
      <ItemActionMenu
        actions={model.actions}
        header={{
          type: "media",
          title: album,
          subtitle: artist,
          imageUrl: model.menuCoverUrl,
          imageAlt: album,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={model.actionMenu.open}
        position={model.actionMenu.position}
        menuRef={model.actionMenu.menuRef}
        onClose={model.actionMenu.close}
      />
    </article>
  );
});
