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
import { albumCoverArtwork, artworkFromUrl } from "@/lib/artwork-source";
import { getOfflineStateLabel, isOfflineBusy } from "@/lib/offline";
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { isSaved, toggleAlbumSaved } = useSavedAlbums();
  const { getAlbumState, getAlbumRecord } = useOffline();
  const [playing, setPlaying] = useState(false);
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
  const offlineMeta =
    offlineState === "ready"
      ? offlineRecord?.trackCount
        ? `${offlineRecord.trackCount} offline`
        : getOfflineStateLabel(offlineState)
      : isOfflineBusy(offlineState) && offlineRecord?.trackCount
        ? `${Math.min(
            offlineRecord.readyTrackCount || 0,
            offlineRecord.trackCount,
          )}/${offlineRecord.trackCount} offline`
        : getOfflineStateLabel(offlineState);
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
          href: albumPagePath({
            ...albumRouteInput,
          }),
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

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group snap-start cursor-pointer rounded-xl p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl",
        layout === "grid"
          ? "listen-deferred-grid-item w-full min-w-0"
          : `flex-shrink-0 ${compact ? "w-[120px]" : "w-[160px]"}`,
        offlineState === "ready"
          ? "bg-cyan-400/[0.04]"
          : isOfflineBusy(offlineState)
            ? "bg-primary/[0.05]"
            : offlineState === "error"
              ? "bg-amber-400/[0.05]"
              : "hover:bg-white/5",
      )}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      onClick={() => navigate(albumPagePath(albumRouteInput))}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(albumPagePath(albumRouteInput));
        }
      }}
    >
      <ArtworkSurface
        source={{
          ...coverArtwork,
          sizes: coverArtwork.srcSet ? coverSizes : undefined,
        }}
        alt={album}
        className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-white/5"
        fallback={
          <div className="grid h-full w-full place-items-center bg-[#171922] text-white/35">
            <Disc3 size={CRATE_ICON_SIZE.xl} />
          </div>
        }
        imageProps={{ loading: "lazy", decoding: "async" }}
        imageClassName="object-cover"
      >
        {(albumId != null || globalAlbumUid) && (
          <FollowHeartButton
            className={`absolute top-2 right-2 z-10 flex h-9 min-h-11 w-9 min-w-11 items-center justify-center rounded-full border border-[var(--idle-border)] bg-black/55 shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-[color,filter,transform] hover:-translate-y-px md:min-h-0 md:min-w-0 ${
              saved ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            following={saved}
            iconSize={CRATE_ICON_SIZE.md}
            aria-label={
              saved
                ? t("album.actions.removeFromCollection")
                : t("album.actions.addToCollection")
            }
            onClick={async (event) => {
              event.stopPropagation();
              try {
                await toggleAlbumSaved(albumId, globalAlbumUid);
              } catch {
                // no-op; page-level toasts can be added later
              }
            }}
          />
        )}
        <OfflineBadge
          state={offlineState}
          compact
          className="absolute left-2 top-2 z-10"
        />
        {isPreRelease ? (
          <span className="absolute left-2 bottom-2 z-10 rounded-full border border-primary/25 bg-black/55 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-primary backdrop-blur-sm">
            Pre-release
          </span>
        ) : null}
        <div className="absolute inset-0 hidden bg-black/0 transition-colors md:flex md:items-center md:justify-center md:p-0 md:group-hover:bg-black/40">
          <button
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary opacity-0 shadow-lg transition-all md:translate-y-2 md:group-hover:translate-y-0 md:group-hover:opacity-100"
            onClick={handlePlayOverlay}
          >
            {playing ? (
              <Loader2
                size={CRATE_ICON_SIZE.lg}
                className="text-primary-foreground animate-spin"
              />
            ) : (
              <Play
                size={CRATE_ICON_SIZE.lg}
                fill="#0a0a0f"
                className="text-primary-foreground ml-0.5"
              />
            )}
          </button>
        </div>
      </ArtworkSurface>
      <div className="truncate text-sm font-medium text-foreground">
        {album}
      </div>
      <div className="truncate text-xs text-muted-foreground">
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
                ? "text-cyan-300/90"
                : isOfflineBusy(offlineState)
                  ? "text-primary"
                  : offlineState === "error"
                    ? "text-amber-300/90"
                    : undefined,
            )}
          >
            · {offlineMeta}
          </span>
        ) : null}
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: album,
          subtitle: artist,
          imageUrl: menuCoverUrl,
          imageAlt: album,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
});
