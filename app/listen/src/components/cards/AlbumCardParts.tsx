import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Disc3 } from "@crate/ui/icons";

import {
  ItemActionMenu,
  type ItemActionMenuEntry,
  type UseItemActionMenuReturn,
} from "@/components/actions/ItemActionMenu";
import { useAlbumActionEntries } from "@/components/actions/album-actions";
import type { AlbumMenuData } from "@/components/actions/shared";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
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

export interface AlbumCardProps {
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
  variant?: "tile" | "row";
  rank?: number;
  meta?: ReactNode;
  extraActions?: ItemActionMenuEntry[];
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
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (state === "ready") {
    return record?.trackCount
      ? t("common.offlineCount", { count: record.trackCount })
      : getOfflineStateLabel(state) ?? "";
  }
  if (isOfflineBusy(state) && record?.trackCount) {
    return t("common.offlineProgress", {
      ready: Math.min(record.readyTrackCount || 0, record.trackCount),
      total: record.trackCount,
    });
  }
  return getOfflineStateLabel(state) ?? "";
}

export function useAlbumCardPlayback({
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

  async function playOverlay(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setPlaying(true);
    try {
      const data = await api<AlbumData>(albumApiPath(albumRouteInput));
      const playerTracks = (data.tracks || []).reduce<Track[]>(
        (tracks, track) => {
          if (track.is_available === false) return tracks;
          tracks.push(
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
          return tracks;
        },
        [],
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

  const playOverlayRef = useRef(playOverlay);
  useEffect(() => {
    playOverlayRef.current = playOverlay;
  });
  const handlePlayOverlay = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => playOverlayRef.current(event),
    [],
  );

  return { playing, handlePlayOverlay };
}

export function AlbumCardArtwork({
  coverArtwork,
  coverSizes,
  album,
  className,
  iconSize = CRATE_ICON_SIZE.xl,
}: {
  coverArtwork: ArtworkSource;
  coverSizes: string;
  album: string;
  className: string;
  iconSize?: number;
}) {
  return (
    <ArtworkSurface
      source={{
        ...coverArtwork,
        sizes: coverArtwork.srcSet ? coverSizes : undefined,
      }}
      alt={album}
      className={className}
      fallback={
        <div className="grid size-full place-items-center bg-surface-elevated text-text-primary/35">
          <Disc3 size={iconSize} />
        </div>
      }
      imageProps={{ loading: "lazy", decoding: "async" }}
      imageClassName="object-cover"
    />
  );
}

export function AlbumCardArtworkBadges({
  offlineState,
  isPreRelease,
}: {
  offlineState: OfflineItemState;
  isPreRelease: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <OfflineBadge
        state={offlineState}
        compact
        className="absolute left-2 top-2 z-10"
      />
      {isPreRelease ? (
        <span className="absolute bottom-2 left-2 z-10 rounded-full border border-accent-action/25 bg-surface-canvas/55 px-2 py-1 text-xs font-semibold uppercase tracking-caps text-accent-action backdrop-blur-sm">
          {t("radar.release.preRelease")}
        </span>
      ) : null}
    </>
  );
}

export function albumCardSubtitle({
  artist,
  year,
  isPreRelease,
  releaseDate,
  language,
  t,
}: {
  artist: string;
  year?: string;
  isPreRelease: boolean;
  releaseDate?: string | null;
  language: string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (isPreRelease && releaseDate) {
    const date = new Date(`${releaseDate}T12:00:00`).toLocaleDateString(
      language,
      { month: "short", day: "numeric" },
    );
    return `${t("album.card.releasesOn", { date })} · ${artist}`;
  }
  return year ? `${year} · ${artist}` : artist;
}

export function AlbumCardSubtitle({
  artist,
  year,
  isPreRelease,
  releaseDate,
  offlineMeta,
  offlineState,
}: {
  artist: string;
  year?: string;
  isPreRelease: boolean;
  releaseDate?: string | null;
  offlineMeta: string;
  offlineState: OfflineItemState;
}) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {albumCardSubtitle({
        artist,
        year,
        isPreRelease,
        releaseDate,
        language: i18n.language,
        t,
      })}
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
    </>
  );
}

export function AlbumCardMenu({
  actionMenu,
  extraActions,
  input,
}: {
  actionMenu: UseItemActionMenuReturn;
  extraActions?: ItemActionMenuEntry[];
  input: AlbumMenuData;
}) {
  const entries = useAlbumActionEntries(input);
  const actions = useMemo(
    () =>
      extraActions?.length
        ? [
            ...entries,
            { type: "divider" as const, key: "divider-extra-actions" },
            ...extraActions,
          ]
        : entries,
    [entries, extraActions],
  );
  const menuCoverUrl = input.cover
    ? resolveMaybeApiAssetUrl(input.cover) || input.cover
    : null;

  return (
    <ItemActionMenu
      actions={actions}
      header={{
        type: "media",
        title: input.album,
        subtitle: input.artist,
        imageUrl: menuCoverUrl,
        imageAlt: input.album,
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

export function useAlbumCardModel({
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
  variant = "tile",
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
    size:
      variant === "row" ? 128 : layout === "grid" ? 320 : compact ? 192 : 256,
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
    variant === "row"
      ? "48px"
      : layout === "grid"
        ? "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 17vw"
        : compact
          ? "120px"
          : "160px";
  const saved = isSaved(albumId, globalAlbumUid);
  const offlineState = getAlbumState(albumId);
  const offlineRecord = getAlbumRecord(albumId);
  const offlineMeta = albumOfflineMeta(offlineState, offlineRecord, t);
  const menuInput = useMemo<AlbumMenuData>(
    () => ({
      artist,
      album,
      albumId,
      albumEntityUid,
      globalAlbumUid,
      artistEntityUid,
      albumSlug,
      artistSlug,
      cover: coverUrl,
      isPreRelease,
    }),
    [
      artist,
      album,
      albumId,
      albumEntityUid,
      globalAlbumUid,
      artistEntityUid,
      albumSlug,
      artistSlug,
      coverUrl,
      isPreRelease,
    ],
  );
  const savedLabel = saved
    ? t("album.actions.removeFromCollection")
    : t("album.actions.addToCollection");

  const handleToggleSaved = useCallback(() => {
    toggleAlbumSaved(albumId, globalAlbumUid).catch(() => undefined);
  }, [toggleAlbumSaved, albumId, globalAlbumUid]);

  return {
    albumRouteInput,
    coverArtwork,
    coverSizes,
    coverUrl,
    isPreRelease,
    menuInput,
    offlineMeta,
    offlineState,
    saved,
    savedLabel,
    handleToggleSaved,
    releaseDate,
    year,
  };
}
