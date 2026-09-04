import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, useLocation } from "react-router";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Clock,
  CRATE_ICON_SIZE,
  Disc,
  Heart,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Radio,
  Share2,
  Shuffle,
  User,
  X,
} from "@crate/ui/icons";
import { toast } from "sonner";

import { AppPopover, AppPopoverDivider } from "@crate/ui/primitives/AppPopover";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useApi } from "@/hooks/use-api";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useContextMenuController } from "@crate/ui/domain/actions";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { QualityBadge } from "@/components/player/bar/QualityBadge";
import { CrateImage } from "@/components/artwork/CrateImage";
import { CrateLoader } from "@/components/ui/CrateLoader";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/components/actions/ItemActionMenu";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { RemoteImportAction } from "@/components/imports/RemoteImportAction";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { ReleaseCountdown } from "@/components/album/ReleaseCountdown";
import { isOfflineBusy } from "@/lib/offline";
import { fetchAlbumRadio } from "@/lib/radio";
import { toPlayableTrack } from "@/lib/playable-track";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { toTrackReferencePayload } from "@/lib/track-reference";
import { toTrackRowData } from "@/lib/track-row-data";
import { shuffleArray, formatTotalDuration } from "@/lib/utils";
import {
  albumApiPath,
  albumCoverApiUrl,
  albumPagePath,
  albumSharePath,
  artistPagePath,
  artistPhotoApiUrl,
  globalAlbumUidFromRouteRef,
} from "@/lib/library-routes";
import {
  buildAlbumPlayerTracks,
  buildAlbumQualityBadges,
} from "@/pages/album-model";
import {
  contributionSourceLabel,
  contributorDisplayName,
  contributorProfilePath,
} from "@/lib/contributions";

function albumGenreSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-");
}

const SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

const ALBUM_MOBILE_INFO_ACTION_GAP_PX = 20;

const ALBUM_MOBILE_HERO_SPACING = {
  "--album-mobile-action-overlap": "2rem",
  "--album-mobile-info-action-gap": `${ALBUM_MOBILE_INFO_ACTION_GAP_PX}px`,
  "--album-mobile-info-y": "0px",
} as CSSProperties;

interface AlbumTrack {
  id: number | string;
  entity_uid?: string;
  globalTrackUid?: string;
  global_track_uid?: string;
  global_uid?: string;
  filename: string;
  format: string;
  size_mb: number;
  bitrate: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  length_sec: number;
  rating: number;
  tags: {
    title: string;
    artist: string;
    album: string;
    albumartist: string;
    tracknumber: string;
    discnumber: string;
    date: string;
    genre: string;
    musicbrainz_albumid: string;
    musicbrainz_trackid: string;
  };
  path?: string | null;
  is_available?: boolean;
  source?: string | null;
  source_url?: string | null;
}

interface AlbumData {
  id?: number | null;
  entity_uid?: string;
  global_album_uid?: string;
  global_artist_uid?: string;
  global_uid?: string;
  slug?: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  artist: string;
  name: string;
  display_name: string;
  path: string;
  track_count: number;
  total_size_mb: number;
  total_length_sec: number;
  has_cover: boolean;
  cover_file: string | null;
  cover_url?: string | null;
  tracks: AlbumTrack[];
  album_tags: {
    artist: string;
    album: string;
    year: string;
    genre: string;
    musicbrainz_albumid: string | null;
  };
  genres: string[];
  genre_profile?: GenreProfileItem[];
  contributors?: AlbumContributor[];
  playable_track_count?: number | null;
  is_pre_release?: boolean;
  release_date?: string | null;
  release_status?: string | null;
  release_type?: string | null;
  source_name?: string | null;
  source_url?: string | null;
  availability?: {
    local?: boolean;
    remote?: boolean;
    healthy?: boolean;
    source_name?: string | null;
  };
}

interface AlbumContributor {
  user_id: number;
  user_email?: string | null;
  user_username?: string | null;
  user_name?: string | null;
  user_avatar?: string | null;
  source?: string | null;
  imported_at?: string | null;
}

export function Album() {
  const { t } = useTranslation();
  const {
    albumId: albumIdParam,
    artistSlug: routeArtistSlug,
    albumSlug: routeAlbumSlug,
    globalAlbumUid: routeGlobalAlbumRef,
  } = useParams<{
    albumId?: string;
    artistSlug?: string;
    albumSlug?: string;
    globalAlbumUid?: string;
  }>();
  const routeGlobalAlbumUid = globalAlbumUidFromRouteRef(routeGlobalAlbumRef);
  const navigate = useNavigate();
  const location = useLocation();
  const sharedTrackUid = new URLSearchParams(location.search).get("track");
  const isDesktop = useIsDesktop();
  const { addToQueue, playAll, playNext } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const { isSaved, saveAlbum, unsaveAlbum } = useSavedAlbums();
  const { isLiked, likeTrack } = useLikedTracks();
  const {
    supported: offlineSupported,
    getAlbumState,
    getAlbumRecord,
    toggleAlbumOffline,
  } = useOffline();
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<number[]>([]);
  const [selectionPlaylistPickerOpen, setSelectionPlaylistPickerOpen] =
    useState(false);
  const [selectionMenuPlaylistOpen, setSelectionMenuPlaylistOpen] =
    useState(false);
  const selectionBarRef = useRef<HTMLDivElement>(null);
  const selectionAnchorTrackIdRef = useRef<number | null>(null);
  const albumHeroInfoRef = useRef<HTMLDivElement>(null);
  const albumPrimaryActionsRef = useRef<HTMLDivElement>(null);
  const [mobileHeroInfoOffset, setMobileHeroInfoOffset] = useState(0);
  const albumMenuController = useContextMenuController<HTMLButtonElement>({
    placement: "bottom-end",
  });
  const selectionMenuController = useContextMenuController<HTMLButtonElement>();

  function clearTrackSelection() {
    selectionAnchorTrackIdRef.current = null;
    setSelectedTrackIds([]);
  }

  const routeAlbumId = albumIdParam ? Number(albumIdParam) : undefined;

  const { data, loading, error } = useApi<AlbumData>(
    routeGlobalAlbumUid
      ? `/api/catalog/albums/${encodeURIComponent(routeGlobalAlbumUid)}`
      : routeAlbumId != null
        ? albumApiPath({ albumId: routeAlbumId })
        : routeArtistSlug && routeAlbumSlug
          ? albumApiPath({
              artistSlug: routeArtistSlug,
              albumSlug: routeAlbumSlug,
            })
          : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const { playlistOptions: playlists, ensurePlaylistOptionsLoaded } =
    useLazyPlaylistOptions();

  function closeAlbumMenu() {
    albumMenuController.close();
    setPlaylistPickerOpen(false);
  }

  useDismissibleLayer({
    active: playlistPickerOpen || selectionPlaylistPickerOpen,
    refs: [
      albumMenuController.menuRef,
      selectionBarRef,
      selectionMenuController.menuRef,
    ],
    onDismiss: () => {
      closeAlbumMenu();
      setSelectionPlaylistPickerOpen(false);
      selectionMenuController.close();
      setSelectionMenuPlaylistOpen(false);
    },
    closeOnScroll: true,
  });

  useEffect(() => {
    clearTrackSelection();
    setSelectionPlaylistPickerOpen(false);
    selectionMenuController.close();
    setSelectionMenuPlaylistOpen(false);
  }, [data?.id]);

  useLayoutEffect(() => {
    if (isDesktop) {
      setMobileHeroInfoOffset((current) => (current === 0 ? current : 0));
      return;
    }

    const info = albumHeroInfoRef.current;
    const actions = albumPrimaryActionsRef.current;
    if (!info || !actions) return;

    let frame = 0;
    const applyMeasurement = () => {
      const infoRect = info.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      if (
        (infoRect.width === 0 && infoRect.height === 0) ||
        (actionsRect.width === 0 && actionsRect.height === 0)
      ) {
        return;
      }

      const currentGap = actionsRect.top - infoRect.bottom;
      const nextOffset = Math.round(
        mobileHeroInfoOffset + currentGap - ALBUM_MOBILE_INFO_ACTION_GAP_PX,
      );

      setMobileHeroInfoOffset((current) =>
        Math.abs(current - nextOffset) > 1 ? nextOffset : current,
      );
    };
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyMeasurement);
    };

    applyMeasurement();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(info);
    resizeObserver?.observe(actions);
    window.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isDesktop, mobileHeroInfoOffset]);

  useEffect(() => {
    if (!data?.name) return;
    if (routeGlobalAlbumUid) {
      const canonicalPath = albumPagePath({
        albumId: typeof data.id === "number" ? data.id : undefined,
        albumEntityUid: data.entity_uid,
        globalAlbumUid: routeGlobalAlbumUid,
        albumSlug: data.slug,
        artistEntityUid: data.artist_entity_uid,
        artistSlug: data.artist_slug,
        artistName: data.artist,
        albumName: data.name,
      });
      if (location.pathname !== canonicalPath) {
        navigate(canonicalPath, { replace: true });
      }
      return;
    }
    const canonicalPath = albumPagePath({
      albumId: data.id,
      albumSlug: data.slug,
      artistSlug: data.artist_slug,
      artistName: data.artist,
      albumName: data.name,
    });
    if (location.pathname !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [
    data?.artist,
    data?.artist_slug,
    data?.id,
    data?.name,
    data?.slug,
    location.pathname,
    navigate,
    routeGlobalAlbumUid,
  ]);

  const hasTracks = Boolean(data?.tracks?.length);

  useEffect(() => {
    if (!sharedTrackUid || !hasTracks) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`track-${sharedTrackUid}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data?.id, hasTracks, sharedTrackUid]);

  if (loading) {
    return <CrateLoader label={t("album.loading")} />;
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">{t("album.notFound")}</p>
      </div>
    );
  }

  const albumData = data;
  const coverUrl =
    resolveMaybeApiAssetUrl(data.cover_url) ||
    albumCoverApiUrl(
      {
        albumId: data.id,
        globalAlbumUid: data.global_album_uid ?? data.global_uid,
        albumEntityUid: data.entity_uid,
        artistEntityUid: data.artist_entity_uid,
        albumSlug: data.slug,
        artistName: data.artist,
        albumName: data.name,
      },
      { size: 768 },
    );
  const artistPhotoUrl = artistPhotoApiUrl(
    {
      artistId: data.artist_id,
      artistEntityUid: data.artist_entity_uid,
      globalArtistUid: data.global_artist_uid,
      artistSlug: data.artist_slug,
      artistName: data.artist,
    },
    { size: 512 },
  );
  const displayName = data.display_name || data.name;
  const albumId = typeof data.id === "number" ? data.id : 0;
  const globalAlbumUid = data.global_album_uid ?? data.global_uid ?? null;
  const globalArtistUid = data.global_artist_uid ?? null;
  const remoteOnly =
    data.availability?.remote === true && data.availability.local !== true;
  const albumHref = albumPagePath({
    albumId: typeof data.id === "number" ? data.id : undefined,
    albumEntityUid: data.entity_uid,
    globalAlbumUid,
    albumSlug: data.slug,
    artistEntityUid: data.artist_entity_uid,
    artistSlug: data.artist_slug,
    artistName: data.artist,
    albumName: displayName,
  });
  const artistName = data.artist;
  const albumTracks = data.tracks;
  const playableAlbumTracks = albumTracks.filter(
    (track) => track.is_available !== false,
  );
  const selectedTrackIdSet = new Set(selectedTrackIds);
  const selectedAlbumTracks = playableAlbumTracks.filter((track) =>
    typeof track.id === "number" ? selectedTrackIdSet.has(track.id) : false,
  );
  const isPreRelease = Boolean(data.is_pre_release);
  const canPersistAlbum = !isPreRelease && albumId > 0;
  const canSaveAlbum =
    !isPreRelease && (albumId > 0 || Boolean(globalAlbumUid));
  const albumRadioSeed =
    !isPreRelease && (albumId > 0 || globalAlbumUid)
      ? albumId > 0
        ? albumId
        : globalAlbumUid
      : null;
  const year = data.album_tags?.year?.slice(0, 4);
  const genre =
    data.genres.length > 0 ? data.genres.join(", ") : data.album_tags?.genre;
  const primaryContributor = data.contributors?.[0] ?? null;
  const primaryContributorName = contributorDisplayName(primaryContributor);
  const primaryContributorPath = contributorProfilePath(primaryContributor);
  const primaryContributorSource = contributionSourceLabel(
    primaryContributor?.source,
  );
  const visibleContributor =
    primaryContributorName && primaryContributor ? primaryContributor : null;
  const playerTracks: Track[] = buildAlbumPlayerTracks(data);
  const saved = canSaveAlbum ? isSaved(albumId, globalAlbumUid) : false;
  const offlineState = getAlbumState(canPersistAlbum ? albumId : undefined);
  const offlineRecord = canPersistAlbum ? getAlbumRecord(albumId) : null;
  const offlineBusy = isOfflineBusy(offlineState);
  const offlineProgress = offlineRecord?.trackCount
    ? `${Math.min(
        offlineRecord.readyTrackCount || 0,
        offlineRecord.trackCount,
      )}/${offlineRecord.trackCount}`
    : null;
  const offlineButtonLabel =
    offlineState === "ready"
      ? t("playlist.offline.available")
      : offlineState === "error"
        ? t("playlist.offline.retry")
        : offlineState === "syncing"
          ? t("playlist.offline.syncing", { progress: offlineProgress || "" })
          : offlineBusy
            ? t("playlist.offline.downloading", {
                progress: offlineProgress || "",
              })
            : t("playlist.offline.makeAvailable");
  const offlineStatusDetail = canPersistAlbum
    ? offlineState === "ready"
      ? offlineRecord?.trackCount
        ? t("playlist.offline.tracksAvailable", {
            count: offlineRecord.trackCount,
          })
        : t("playlist.offline.available")
      : offlineBusy && offlineProgress
        ? t("playlist.offline.progressSaved", { progress: offlineProgress })
        : offlineState === "error"
          ? offlineRecord?.readyTrackCount
            ? t("playlist.offline.partialError", {
                ready: offlineRecord.readyTrackCount,
                total: offlineRecord.trackCount,
              })
            : t("album.offline.failed")
          : null
    : null;

  const qualityBadges = buildAlbumQualityBadges(albumTracks);
  const hasMultipleDiscs = albumTracks.some(
    (t) => t.tags.discnumber && parseInt(t.tags.discnumber) > 1,
  );

  const handlePlay = (startIndex = 0) => {
    if (playerTracks.length > 0) {
      playAll(playerTracks, startIndex, {
        type: "album",
        name: `${artistName} — ${displayName}`,
        href: albumHref,
        radio:
          albumRadioSeed != null
            ? {
                seedType: "album",
                seedId: albumRadioSeed,
              }
            : undefined,
      });
    }
  };

  const handlePlayTrack = (trackId: number | string) => {
    const startIndex = playableAlbumTracks.findIndex(
      (track) => track.id === trackId,
    );
    if (startIndex < 0) return;
    clearTrackSelection();
    setSelectionPlaylistPickerOpen(false);
    handlePlay(startIndex);
  };

  const handleShuffle = () => {
    if (playerTracks.length === 0) return;
    const shuffled = shuffleArray(playerTracks);
    playAll(shuffled, 0, {
      type: "album",
      name: `${artistName} — ${displayName}`,
      href: albumHref,
      radio:
        albumRadioSeed != null
          ? {
              seedType: "album",
              seedId: albumRadioSeed,
            }
          : undefined,
    });
  };

  async function handleAlbumRadio() {
    if (albumRadioSeed == null) {
      toast.info(t("album.toasts.radioUnavailable"));
      return;
    }
    if (isPreRelease) {
      toast.info(t("album.toasts.radioPrerelease"));
      return;
    }
    try {
      const radio = await fetchAlbumRadio({
        albumId: albumRadioSeed,
        artistName,
        albumName: displayName,
      });
      if (!radio.tracks.length) {
        toast.info(t("album.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("album.toasts.radioFailed"));
    }
  }

  const handlePlayNextAlbum = () => {
    [...playerTracks].reverse().forEach((track) => playNext(track));
    toast.success(t("album.toasts.queuedNext"));
    closeAlbumMenu();
  };

  const shareUrl = publicShareUrl(
    albumSharePath({
      albumId,
      globalAlbumUid,
      albumEntityUid: data.entity_uid,
      albumSlug: data.slug,
      artistEntityUid: data.artist_entity_uid,
      artistSlug: data.artist_slug,
      artistName,
      albumName: data.name,
    }),
  );

  function trackPreviewId(track: AlbumTrack) {
    return track.entity_uid ? `track-${track.entity_uid}` : undefined;
  }

  function sharedTrackClass(track: AlbumTrack) {
    return sharedTrackUid && track.entity_uid === sharedTrackUid
      ? "rounded-xl ring-1 ring-primary/35 bg-primary/5"
      : "";
  }

  function albumTrackRowData(track: AlbumTrack, fallbackIndex: number) {
    const globalTrackUid =
      track.globalTrackUid ?? track.global_track_uid ?? track.global_uid;
    return toTrackRowData({
      id: track.id,
      globalTrackUid,
      global_artist_uid: globalArtistUid,
      global_album_uid: globalAlbumUid,
      entity_uid: track.entity_uid,
      title: track.tags.title || track.filename,
      artist: albumData.artist,
      artist_id: albumData.artist_id,
      artist_entity_uid: albumData.artist_entity_uid,
      artist_slug: albumData.artist_slug,
      album: displayName,
      album_id: albumId > 0 ? albumId : undefined,
      album_entity_uid: albumData.entity_uid,
      album_slug: albumData.slug,
      duration: track.length_sec,
      path: track.path,
      track_number: parseInt(track.tags.tracknumber) || fallbackIndex + 1,
      format: track.format,
      bitrate: track.bitrate,
      sample_rate: track.sample_rate,
      bit_depth: track.bit_depth,
      bpm: track.bpm,
      audio_key: track.audio_key,
      audio_scale: track.audio_scale,
      energy: track.energy,
      danceability: track.danceability,
      valence: track.valence,
      bliss_vector: track.bliss_vector,
      library_track_id:
        track.is_available === false || typeof track.id !== "number"
          ? undefined
          : track.id,
      disabled: track.is_available === false,
    });
  }

  async function handleShare() {
    openShareSheet({
      kind: "album",
      title: displayName,
      subtitle: artistName,
      imageUrl: coverUrl,
      url: shareUrl,
    });
  }

  async function handleToggleSaved() {
    if (!canSaveAlbum) return;
    try {
      if (saved) {
        await unsaveAlbum(albumId, globalAlbumUid);
      } else {
        await saveAlbum(albumId, globalAlbumUid);
      }
    } catch {
      // Saved state remains unchanged when the request fails.
    }
  }

  async function handleToggleOffline() {
    if (!canPersistAlbum) return;
    try {
      const result = await toggleAlbumOffline({ albumId, title: displayName });
      toast.success(
        result === "removed"
          ? t("playlist.toasts.offlineRemoved")
          : t("album.toasts.availableOffline"),
      );
    } catch (error) {
      toast.error(
        (error as Error).message || t("playlist.toasts.offlineUpdateFailed"),
      );
    }
  }

  const playlistTracksPayload = playableAlbumTracks.map((track) => ({
    ...toTrackReferencePayload({
      id: track.id,
      globalTrackUid:
        track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
      entity_uid: track.entity_uid,
      path: track.path,
      title: track.tags.title || track.filename,
      artist: artistName,
      album: displayName,
      duration: track.length_sec,
      library_track_id: typeof track.id === "number" ? track.id : undefined,
    }),
  }));
  const selectedPlaylistTracksPayload = selectedAlbumTracks.map((track) => ({
    ...toTrackReferencePayload({
      id: track.id,
      globalTrackUid:
        track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
      entity_uid: track.entity_uid,
      path: track.path,
      title: track.tags.title || track.filename,
      artist: artistName,
      album: displayName,
      duration: track.length_sec,
      library_track_id: typeof track.id === "number" ? track.id : undefined,
    }),
  }));
  const selectedPlayerTracks = selectedAlbumTracks.map((track) =>
    toPlayableTrack({
      id: track.id,
      globalTrackUid:
        track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
      entity_uid: track.entity_uid,
      title: track.tags.title || track.filename,
      artist: artistName,
      global_artist_uid: globalArtistUid,
      artist_entity_uid: albumData.artist_entity_uid,
      album: displayName,
      global_album_uid: globalAlbumUid,
      album_entity_uid: albumData.entity_uid,
      duration: track.length_sec,
      path: track.path,
      library_track_id: typeof track.id === "number" ? track.id : undefined,
      bpm: track.bpm,
      audio_key: track.audio_key,
      audio_scale: track.audio_scale,
      energy: track.energy,
      danceability: track.danceability,
      valence: track.valence,
      bliss_vector: track.bliss_vector,
    }),
  );

  async function handleAddToPlaylist(playlistId: number) {
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: playlistTracksPayload,
      });
      toast.success(t("album.toasts.addedToPlaylist"));
      closeAlbumMenu();
      setPlaylistPickerOpen(false);
    } catch {
      toast.error(t("album.toasts.addToPlaylistFailed"));
    }
  }

  async function handleAddSelectedToPlaylist(playlistId: number) {
    if (!selectedPlaylistTracksPayload.length) return;
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: selectedPlaylistTracksPayload,
      });
      toast.success(
        t("album.toasts.selectedAddedToPlaylist", {
          count: selectedPlaylistTracksPayload.length,
        }),
      );
      clearTrackSelection();
      setSelectionPlaylistPickerOpen(false);
      handleCloseSelectionMenu();
    } catch {
      toast.error(t("album.toasts.addSelectedFailed"));
    }
  }

  function handleCloseSelectionMenu() {
    selectionMenuController.close();
    setSelectionMenuPlaylistOpen(false);
  }

  function handlePlaySelectedNext() {
    if (!selectedPlayerTracks.length) return;
    [...selectedPlayerTracks].reverse().forEach((track) => playNext(track));
    toast.success(
      t("album.toasts.selectedQueuedNext", {
        count: selectedPlayerTracks.length,
      }),
    );
    handleCloseSelectionMenu();
  }

  function handleAddSelectedToQueue() {
    if (!selectedPlayerTracks.length) return;
    selectedPlayerTracks.forEach((track) => addToQueue(track));
    toast.success(
      t("album.toasts.selectedAddedToQueue", {
        count: selectedPlayerTracks.length,
      }),
    );
    handleCloseSelectionMenu();
  }

  async function handleAddSelectedToCollection() {
    const missing = selectedAlbumTracks.filter(
      (track) =>
        !isLiked(
          typeof track.id === "number" ? track.id : null,
          track.entity_uid,
          track.path,
          track.global_track_uid,
        ),
    );
    if (!missing.length) {
      toast.info(t("album.toasts.selectedAlreadyCollection"));
      handleCloseSelectionMenu();
      return;
    }

    try {
      await Promise.all(
        missing.map((track) =>
          likeTrack(
            typeof track.id === "number" ? track.id : null,
            track.entity_uid ?? null,
            track.path,
            track.global_track_uid ?? null,
          ),
        ),
      );
      toast.success(
        t("album.toasts.selectedAddedCollection", { count: missing.length }),
      );
      handleCloseSelectionMenu();
    } catch {
      toast.error(t("album.toasts.updateCollectionFailed"));
    }
  }

  async function handleAddTrackToPlaylist(
    playlistId: number,
    track: TrackRowData,
  ) {
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [
          toTrackReferencePayload({
            ...track,
            album: track.album || displayName,
            duration: track.duration || 0,
          }),
        ],
      });
      toast.success(
        t("album.toasts.trackAddedToPlaylist", { title: track.title }),
      );
    } catch {
      toast.error(t("album.toasts.addTrackToPlaylistFailed"));
    }
  }

  function handleCreatePlaylistFromAlbum() {
    openCreatePlaylist({
      name: displayName,
      tracks: playableAlbumTracks.map((track) =>
        toPlayableTrack({
          id: track.id,
          globalTrackUid:
            track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
          global_artist_uid: globalArtistUid,
          global_album_uid: globalAlbumUid,
          entity_uid: track.entity_uid,
          title: track.tags.title || track.filename,
          artist: artistName,
          artist_entity_uid: data?.artist_entity_uid,
          album: displayName,
          album_entity_uid: data?.entity_uid,
          duration: track.length_sec,
          path: track.path,
          library_track_id: typeof track.id === "number" ? track.id : undefined,
          bpm: track.bpm,
          audio_key: track.audio_key,
          audio_scale: track.audio_scale,
          energy: track.energy,
          danceability: track.danceability,
          valence: track.valence,
          bliss_vector: track.bliss_vector,
        }),
      ),
    });
    closeAlbumMenu();
    setPlaylistPickerOpen(false);
  }

  function handleCreatePlaylistFromTrack(track: TrackRowData) {
    openCreatePlaylist({
      tracks: [
        toPlayableTrack({
          ...track,
          album: track.album || displayName,
          library_track_id:
            track.library_track_id ??
            (typeof track.id === "number" ? track.id : undefined),
        }),
      ],
    });
  }

  function handleCreatePlaylistFromSelection() {
    if (!selectedPlayerTracks.length) return;
    openCreatePlaylist({
      name: `${displayName} selection`,
      tracks: selectedPlayerTracks,
    });
    clearTrackSelection();
    setSelectionPlaylistPickerOpen(false);
    handleCloseSelectionMenu();
  }

  function handleTogglePlaylistPicker() {
    ensurePlaylistOptionsLoaded();
    setPlaylistPickerOpen((open) => !open);
  }

  function handleToggleAlbumMenu(event: MouseEvent<HTMLButtonElement>) {
    albumMenuController.openFromTrigger(event);
  }

  function handleToggleSelectionPlaylistPicker() {
    ensurePlaylistOptionsLoaded();
    setSelectionPlaylistPickerOpen((open) => !open);
  }

  function handleTrackSelection(
    trackId: number,
    event: MouseEvent<HTMLDivElement>,
  ) {
    const orderedTrackIds = playableAlbumTracks
      .map((track) => track.id)
      .filter((id): id is number => typeof id === "number");
    const trackIndex = orderedTrackIds.indexOf(trackId);
    const anchorTrackId = selectionAnchorTrackIdRef.current;
    const anchorIndex =
      anchorTrackId == null ? -1 : orderedTrackIds.indexOf(anchorTrackId);
    const additive = event.metaKey || event.ctrlKey;
    const rangeSelection =
      event.shiftKey && anchorIndex >= 0 && trackIndex >= 0;

    setSelectedTrackIds((current) => {
      if (rangeSelection) {
        const start = Math.min(anchorIndex, trackIndex);
        const end = Math.max(anchorIndex, trackIndex);
        const range = orderedTrackIds.slice(start, end + 1);
        return additive ? Array.from(new Set([...current, ...range])) : range;
      }

      if (additive) {
        return current.includes(trackId)
          ? current.filter((id) => id !== trackId)
          : [...current, trackId];
      }

      return [trackId];
    });

    if (!rangeSelection) {
      selectionAnchorTrackIdRef.current = trackId;
    }
  }

  function openSelectionMenu(trackId: number, x: number, y: number) {
    if (!isDesktop) return false;
    if (!selectedTrackIdSet.has(trackId)) {
      selectionAnchorTrackIdRef.current = trackId;
      setSelectedTrackIds([trackId]);
    }
    ensurePlaylistOptionsLoaded();
    setSelectionPlaylistPickerOpen(false);
    setSelectionMenuPlaylistOpen(false);
    selectionMenuController.openAtPoint(x, y);
    return true;
  }

  function handleSelectionActionMenuOpen(
    trackId: number,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    return openSelectionMenu(trackId, rect.right - 8, rect.bottom + 8);
  }

  // Group tracks by disc if multi-disc
  const tracksByDisc = new Map<number, AlbumTrack[]>();
  for (const t of data.tracks) {
    const disc = parseInt(t.tags.discnumber) || 1;
    if (!tracksByDisc.has(disc)) tracksByDisc.set(disc, []);
    tracksByDisc.get(disc)!.push(t);
  }

  const albumMenuItems: ContextMenuEntry[] = [
    {
      key: "play",
      label: t("album.actions.playNow"),
      icon: Play,
      onSelect: () => handlePlay(),
    },
    {
      key: "play-next",
      label: t("album.actions.playNext"),
      icon: ListPlus,
      onSelect: handlePlayNextAlbum,
    },
    ...(canPersistAlbum
      ? [
          {
            type: "disclosure" as const,
            key: "playlist",
            label: t("playlist.actions.addToPlaylist"),
            icon: ListPlus,
            expanded: playlistPickerOpen,
            onToggle: handleTogglePlaylistPicker,
            items: [
              {
                key: "playlist-create",
                label: t("playlist.actions.addNew"),
                onSelect: handleCreatePlaylistFromAlbum,
              },
              ...playlists.map((playlist) => ({
                key: `playlist-${playlist.id}`,
                label: playlist.name,
                onSelect: () => handleAddToPlaylist(playlist.id),
              })),
            ],
          },
        ]
      : []),
    ...(canSaveAlbum
      ? [
          {
            key: "save",
            label: saved
              ? t("album.actions.removeFromCollection")
              : t("album.actions.addToCollection"),
            icon: Heart,
            active: saved,
            onSelect: handleToggleSaved,
          },
        ]
      : []),
    ...(canPersistAlbum
      ? [
          {
            key: "offline",
            label: offlineButtonLabel,
            icon:
              offlineState === "ready"
                ? ArrowDownToLineBold
                : isOfflineBusy(offlineState)
                  ? Loader2
                  : offlineState === "error"
                    ? AlertCircle
                    : ArrowDownToLine,
            active: offlineState === "ready",
            disabled: !offlineSupported || isOfflineBusy(offlineState),
            onSelect: handleToggleOffline,
          },
        ]
      : []),
    {
      key: "artist",
      label: t("album.actions.goToArtist"),
      icon: User,
      onSelect: () =>
        navigate(
          globalArtistUid
            ? artistPagePath({
                artistId: data.artist_id,
                artistEntityUid: data.artist_entity_uid,
                globalArtistUid,
                artistSlug: data.artist_slug,
                artistName,
              })
            : artistPagePath({
                artistId: data.artist_id,
                artistSlug: data.artist_slug,
                artistName,
              }),
        ),
    },
    {
      key: "share",
      label: t("common.share"),
      icon: Share2,
      onSelect: handleShare,
    },
  ];

  const selectionMenuItems: ContextMenuEntry[] = [
    {
      type: "label",
      key: "selected-count",
      label: t("common.selectedCount", { count: selectedAlbumTracks.length }),
    },
    {
      key: "play-next",
      label: t("album.actions.playNext"),
      icon: ListPlus,
      onSelect: handlePlaySelectedNext,
    },
    {
      key: "queue",
      label: t("album.actions.addToQueue"),
      icon: Plus,
      onSelect: handleAddSelectedToQueue,
    },
    {
      type: "disclosure",
      key: "playlist",
      label: t("playlist.actions.addToPlaylist"),
      icon: ListPlus,
      expanded: selectionMenuPlaylistOpen,
      onToggle: () => {
        ensurePlaylistOptionsLoaded();
        setSelectionMenuPlaylistOpen((open) => !open);
      },
      items: [
        {
          key: "playlist-create",
          label: t("playlist.actions.addNew"),
          onSelect: handleCreatePlaylistFromSelection,
        },
        ...playlists.map((playlist) => ({
          key: `playlist-${playlist.id}`,
          label: playlist.name,
          onSelect: () => handleAddSelectedToPlaylist(playlist.id),
        })),
      ],
    },
    {
      type: "divider",
      key: "collection-divider",
    },
    {
      key: "collection",
      label: t("album.actions.addToMyCollection"),
      icon: Heart,
      onSelect: handleAddSelectedToCollection,
    },
  ];
  const mobileAlbumMenuTrigger =
    !isDesktop && typeof document !== "undefined" ? (
      <div
        className="fixed z-app-header"
        style={{
          top: "calc(var(--listen-safe-top) + 0.625rem)",
          right: "max(1rem, var(--listen-safe-right))",
        }}
      >
        <button
          ref={albumMenuController.anchorRef}
          data-testid="album-mobile-hero-menu"
          className="flex h-11 w-11 touch-manipulation items-center justify-center text-text-primary/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-accent-action-hover"
          onClick={handleToggleAlbumMenu}
          aria-label={t("common.more")}
        >
          <MoreHorizontal
            data-testid="album-mobile-hero-menu-icon"
            size={CRATE_ICON_SIZE.navMobile}
            className="rotate-90"
          />
        </button>
        <ContextMenu
          header={{
            type: "media",
            title: displayName,
            subtitle: data.artist,
            imageUrl: data.has_cover || coverUrl ? coverUrl : undefined,
            imageAlt: displayName,
            imageShape: "square",
            fallbackIcon: Disc,
          }}
          items={albumMenuItems}
          menuRef={albumMenuController.menuRef}
          onClose={closeAlbumMenu}
          open={albumMenuController.open}
          position={albumMenuController.position}
        />
      </div>
    ) : null;
  const albumHeroStyle = {
    ...ALBUM_MOBILE_HERO_SPACING,
    "--album-mobile-info-y": `${mobileHeroInfoOffset}px`,
  } as CSSProperties;

  return (
    <div
      data-testid="album-shell"
      className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6"
      style={albumHeroStyle}
    >
      {mobileAlbumMenuTrigger
        ? createPortal(mobileAlbumMenuTrigger, document.body)
        : null}
      {/* Header */}
      <div className="relative min-h-[520px] overflow-hidden sm:h-[430px] sm:min-h-0 lg:h-[460px]">
        {data.has_cover || data.cover_url ? (
          <CrateImage
            data-testid="album-hero-background"
            src={coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-[1.04] object-cover brightness-[0.72] contrast-110 opacity-[0.82] sm:grayscale sm:brightness-[0.42] sm:opacity-[0.42]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-surface-canvas/10 sm:bg-surface-canvas/32" />
        <div
          className="absolute inset-0 sm:hidden"
          data-testid="album-hero-mobile-gradient"
          style={{ background: "var(--hero-artwork-gradient-mobile)" }}
        />
        <div
          className="absolute inset-0 hidden sm:block"
          data-testid="album-hero-desktop-gradient"
          style={{ background: "var(--hero-artwork-gradient-desktop)" }}
        />
        <div
          data-testid="album-hero-content"
          className="relative mx-auto flex h-full w-full max-w-[1480px] items-end px-4 pb-[calc(var(--album-mobile-action-overlap)+var(--album-mobile-info-action-gap))] pt-[var(--listen-mobile-page-top)] sm:px-6 sm:pb-6 sm:pt-0"
        >
          <div className="flex w-full flex-col gap-6 sm:flex-row sm:items-end">
            {/* Cover */}
            <div className="w-[200px] flex-shrink-0 self-center sm:w-[240px] sm:self-auto lg:w-[280px]">
              <div
                data-testid="album-mobile-cover-spacer"
                aria-hidden="true"
                className="aspect-square sm:hidden"
              />
              <div
                data-testid="album-desktop-cover"
                className="hidden aspect-square overflow-hidden rounded-xl bg-text-primary/5 shadow-2xl ring-1 ring-text-primary/10 sm:block"
              >
                {data.has_cover || data.cover_url ? (
                  <CrateImage
                    src={coverUrl}
                    alt={displayName}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Disc size={64} className="text-text-primary/10" />
                  </div>
                )}
              </div>
            </div>

            {/* Info */}
            <div
              ref={albumHeroInfoRef}
              data-testid="album-hero-info"
              className="flex min-w-0 translate-y-[var(--album-mobile-info-y)] flex-col justify-end text-left sm:translate-y-0"
            >
              <div className="mb-1.5 flex flex-col items-start gap-2">
                {isPreRelease ? (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                    Pre-release
                  </span>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="max-w-4xl text-2xl font-bold text-foreground sm:text-4xl">
                    {displayName}
                  </h1>
                  {canPersistAlbum ? (
                    <OfflineBadge state={offlineState} />
                  ) : null}
                </div>
              </div>
              <button
                className="mb-3 inline-flex items-center gap-2 self-start text-sm text-muted-foreground transition-colors hover:text-primary"
                onClick={() =>
                  navigate(
                    globalArtistUid
                      ? artistPagePath({
                          artistId: data.artist_id,
                          artistEntityUid: data.artist_entity_uid,
                          globalArtistUid,
                          artistSlug: data.artist_slug,
                          artistName,
                        })
                      : artistPagePath({
                          artistId: data.artist_id,
                          artistSlug: data.artist_slug,
                          artistName,
                        }),
                  )
                }
              >
                <span className="h-6 w-6 flex-shrink-0 overflow-hidden rounded-full bg-text-primary/5">
                  <CrateImage
                    src={artistPhotoUrl}
                    alt={data.artist}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </span>
                {data.artist}
              </button>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {year && <span>{year}</span>}
                {isPreRelease && data.release_date ? (
                  <span>
                    Releases{" "}
                    {new Date(
                      `${data.release_date}T12:00:00`,
                    ).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                ) : null}
                {!data.genre_profile?.length && genre ? (
                  <span className="hidden sm:inline">{genre}</span>
                ) : null}
                {data.track_count > 0 && (
                  <span>
                    {t("common.trackCountLabel", {
                      count: data.track_count,
                    })}
                  </span>
                )}
                {isPreRelease ? (
                  <span>{playerTracks.length} available now</span>
                ) : null}
                {data.total_length_sec > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {formatTotalDuration(data.total_length_sec)}
                  </span>
                )}
                {qualityBadges.map((badge) => (
                  <QualityBadge
                    key={`${badge.tier}-${badge.label}`}
                    badge={badge}
                  />
                ))}
              </div>

              {isPreRelease && data.release_date ? (
                <ReleaseCountdown releaseDate={data.release_date} />
              ) : null}

              {visibleContributor ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-text-primary/8 ring-1 ring-text-primary/10">
                    {visibleContributor.user_avatar ? (
                      <CrateImage
                        src={visibleContributor.user_avatar}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <User size={13} />
                    )}
                  </span>
                  <span>
                    Added to Crate by{" "}
                    {primaryContributorPath ? (
                      <UserProfileLink
                        username={primaryContributor?.user_username}
                        to={primaryContributorPath}
                        className="font-medium text-foreground/85 transition-colors hover:text-primary"
                      >
                        {primaryContributorName}
                      </UserProfileLink>
                    ) : (
                      <span className="font-medium text-foreground/85">
                        {primaryContributorName}
                      </span>
                    )}
                    {primaryContributorSource ? (
                      <span className="text-muted-foreground/70">
                        {" "}
                        via {primaryContributorSource}
                      </span>
                    ) : null}
                  </span>
                </div>
              ) : null}

              {data.genre_profile && data.genre_profile.length > 0 ? (
                <GenrePillRow
                  items={data.genre_profile}
                  max={6}
                  className="mt-3 hidden sm:flex"
                  onSelect={(item) =>
                    navigate(
                      `/explore?genre=${encodeURIComponent(
                        item.slug || albumGenreSlug(item.name),
                      )}`,
                    )
                  }
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div
        data-testid="album-action-row"
        className="relative z-10 -mt-[var(--album-mobile-action-overlap)] px-4 pb-4 pt-0 sm:mt-0 sm:px-0 sm:py-4"
      >
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6">
          <div
            ref={albumPrimaryActionsRef}
            data-testid="album-primary-actions"
            role="group"
            aria-label={t("album.actions.primaryGroup")}
            className="grid grid-cols-2 gap-3 md:flex md:shrink-0 md:items-center md:gap-3"
          >
            <button
              className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-action-solid transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-primary/90 hover:shadow-action-solid-hover disabled:cursor-not-allowed disabled:opacity-45 md:px-7 md:text-[15px]"
              onClick={() => handlePlay()}
              disabled={playerTracks.length === 0}
              aria-label={t("player.play")}
            >
              <Play size={17} fill="currentColor" />
              <span>{t("player.play")}</span>
            </button>
            <button
              className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-text-primary/[0.08] px-5 text-sm font-semibold text-foreground shadow-control-inset transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-text-primary/[0.12] hover:text-primary hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:opacity-45 md:w-auto md:px-7"
              onClick={handleShuffle}
              disabled={playerTracks.length === 0}
              aria-label={t("player.shuffle")}
            >
              <Shuffle size={17} />
              <span>{t("player.shuffle")}</span>
            </button>
          </div>

          <div
            role="group"
            aria-label={t("album.actions.secondaryGroup")}
            className="grid grid-cols-5 items-start gap-2 md:ml-auto md:flex md:shrink-0 md:items-center md:gap-4"
          >
            {!isPreRelease ? (
              <button
                className={SECONDARY_ACTION_CLASS}
                onClick={handleAlbumRadio}
                aria-label={t("album.actions.radio")}
              >
                <Radio size={CRATE_ICON_SIZE.lg} />
                <span>Radio</span>
              </button>
            ) : null}
            {canPersistAlbum ? (
              <button
                className={`${SECONDARY_ACTION_CLASS} ${
                  offlineState === "ready"
                    ? "text-text-accent drop-shadow-accent-action"
                    : offlineBusy
                      ? "text-primary"
                      : offlineState === "error"
                        ? "text-state-warning-text/90"
                        : "text-text-primary/62"
                }`}
                onClick={handleToggleOffline}
                disabled={!offlineSupported || offlineBusy}
                aria-label={
                  offlineState === "ready"
                    ? t("playlist.offline.removeCopy")
                    : t("playlist.offline.makeAvailable")
                }
                title={offlineButtonLabel}
              >
                {offlineState === "ready" ? (
                  <ArrowDownToLineBold size={CRATE_ICON_SIZE.lg} />
                ) : offlineBusy ? (
                  <Loader2 size={CRATE_ICON_SIZE.lg} className="animate-spin" />
                ) : offlineState === "error" ? (
                  <AlertCircle size={CRATE_ICON_SIZE.lg} />
                ) : (
                  <ArrowDownToLine size={CRATE_ICON_SIZE.lg} />
                )}
                <span>{t("common.offline")}</span>
              </button>
            ) : null}
            {canSaveAlbum ? (
              <FollowHeartButton
                className={`${SECONDARY_ACTION_CLASS} ${
                  saved
                    ? "text-primary drop-shadow-accent-action"
                    : "text-text-primary/62"
                }`}
                onClick={handleToggleSaved}
                aria-label={
                  saved
                    ? t("album.actions.removeFromCollection")
                    : t("album.actions.addToCollection")
                }
                following={saved}
                iconSize={CRATE_ICON_SIZE.lg}
              >
                <span>{saved ? t("common.added") : t("common.add")}</span>
              </FollowHeartButton>
            ) : null}
            <button
              className={SECONDARY_ACTION_CLASS}
              onClick={handleShare}
              aria-label={t("common.share")}
            >
              <Share2 size={CRATE_ICON_SIZE.lg} />
              <span>{t("common.share")}</span>
            </button>
            <BandcampSupportButton
              entityType="album"
              entityUid={data.entity_uid}
              fallbackArtistEntityUid={data.artist_entity_uid}
              presentation="secondary-action"
            />
            {isDesktop ? (
              <div className="relative shrink-0">
                <button
                  ref={albumMenuController.anchorRef}
                  className={SECONDARY_ACTION_CLASS}
                  onClick={handleToggleAlbumMenu}
                  aria-label={t("common.more")}
                >
                  <MoreHorizontal size={CRATE_ICON_SIZE.lg} />
                  <span>{t("common.more")}</span>
                </button>
                <ContextMenu
                  header={{
                    type: "media",
                    title: displayName,
                    subtitle: data.artist,
                    imageUrl: data.has_cover || coverUrl ? coverUrl : undefined,
                    imageAlt: displayName,
                    imageShape: "square",
                    fallbackIcon: Disc,
                  }}
                  items={albumMenuItems}
                  menuRef={albumMenuController.menuRef}
                  onClose={closeAlbumMenu}
                  open={albumMenuController.open}
                  position={albumMenuController.position}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {remoteOnly && globalAlbumUid ? (
        <div className="px-4 pb-4 sm:px-6">
          <div className="mx-auto w-full max-w-[1480px]">
            <RemoteImportAction
              globalAlbumUid={globalAlbumUid}
              estimatedBytes={
                data.total_size_mb > 0 ? data.total_size_mb * 1_000_000 : null
              }
              sourceName={data.availability?.source_name}
            />
          </div>
        </div>
      ) : null}

      {offlineStatusDetail ? (
        <div className="px-4 sm:px-6 pb-4">
          <div className="mx-auto w-full max-w-[1480px]">
            <p className="text-xs text-muted-foreground">
              {offlineStatusDetail}
            </p>
          </div>
        </div>
      ) : null}

      {isPreRelease ? (
        <div className="px-4 sm:px-6 pb-4">
          <div className="mx-auto w-full max-w-[1480px] rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-primary/90">
            {t("album.prereleaseNotice")}
          </div>
        </div>
      ) : null}

      {/* Track List */}
      <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 pb-8">
        {isDesktop && selectedAlbumTracks.length > 0 ? (
          <div
            ref={selectionBarRef}
            className="listen-glass-panel mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-3"
          >
            <div className="mr-auto min-w-0 px-1">
              <p className="text-sm font-semibold text-foreground">
                {t("common.selectedCount", {
                  count: selectedAlbumTracks.length,
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("album.selection.doubleClickHint")}
              </p>
            </div>
            <div className="relative">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-full border border-text-primary/12 bg-text-primary/6 px-3 text-xs font-medium text-foreground transition-colors hover:bg-text-primary/10"
                onClick={handleToggleSelectionPlaylistPicker}
              >
                <ListPlus size={14} />
                {t("playlist.actions.addToPlaylist")}
              </button>
              {selectionPlaylistPickerOpen ? (
                <AppPopover className="absolute top-full right-0 z-app-popover mt-2 w-64 overflow-hidden rounded-[12px]">
                  <div className="p-1.5">
                    <button
                      className="w-full rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-text-primary/5"
                      onClick={handleCreatePlaylistFromSelection}
                    >
                      {t("playlist.actions.addNew")}
                    </button>
                    {playlists.length > 0 ? (
                      <AppPopoverDivider className="mx-1" />
                    ) : null}
                    {playlists.map((playlist) => (
                      <button
                        key={playlist.id}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-text-primary/5 hover:text-foreground"
                        onClick={() =>
                          void handleAddSelectedToPlaylist(playlist.id)
                        }
                      >
                        {playlist.name}
                      </button>
                    ))}
                  </div>
                </AppPopover>
              ) : null}
            </div>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-full border border-text-primary/12 bg-text-primary/6 px-3 text-xs font-medium text-foreground transition-colors hover:bg-text-primary/10"
              onClick={handleCreatePlaylistFromSelection}
            >
              {t("playlist.actions.create")}
            </button>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-text-primary/12 bg-text-primary/6 text-muted-foreground transition-colors hover:bg-text-primary/10 hover:text-foreground"
              onClick={clearTrackSelection}
              aria-label={t("album.selection.clear")}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        <ContextMenu
          items={selectionMenuItems}
          menuRef={selectionMenuController.menuRef}
          onClose={handleCloseSelectionMenu}
          open={selectionMenuController.open && selectedAlbumTracks.length > 0}
          position={selectionMenuController.position}
        />
        {hasMultipleDiscs
          ? [...tracksByDisc.entries()]
              .sort(([a], [b]) => a - b)
              .map(([disc, tracks]) => (
                <div key={disc} className="mb-4">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Disc size={12} />
                    {t("album.disc", { disc })}
                  </div>
                  {tracks.map((t, idx) => {
                    const rowTrack = albumTrackRowData(t, idx);
                    return (
                      <div
                        key={t.id}
                        id={trackPreviewId(t)}
                        className={sharedTrackClass(t)}
                      >
                        <TrackRow
                          track={rowTrack}
                          index={parseInt(t.tags.tracknumber) || idx + 1}
                          albumCover={coverUrl}
                          playlistOptions={playlists ?? undefined}
                          onAddToPlaylist={handleAddTrackToPlaylist}
                          onCreatePlaylist={handleCreatePlaylistFromTrack}
                          onActionMenuOpen={ensurePlaylistOptionsLoaded}
                          onPlayOverride={() => handlePlayTrack(t.id)}
                          selectable={isDesktop && canPersistAlbum}
                          selected={
                            typeof t.id === "number" &&
                            selectedTrackIdSet.has(t.id)
                          }
                          onSelect={(_, event) => {
                            if (typeof t.id === "number")
                              handleTrackSelection(t.id, event);
                          }}
                          onSelectionActionMenuOpen={(_, event) =>
                            typeof t.id === "number"
                              ? handleSelectionActionMenuOpen(t.id, event)
                              : false
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ))
          : data.tracks.map((t, idx) => {
              const rowTrack = albumTrackRowData(t, idx);
              return (
                <div
                  key={t.id}
                  id={trackPreviewId(t)}
                  className={sharedTrackClass(t)}
                >
                  <TrackRow
                    track={rowTrack}
                    index={parseInt(t.tags.tracknumber) || idx + 1}
                    albumCover={coverUrl}
                    playlistOptions={playlists ?? undefined}
                    onAddToPlaylist={handleAddTrackToPlaylist}
                    onCreatePlaylist={handleCreatePlaylistFromTrack}
                    onActionMenuOpen={ensurePlaylistOptionsLoaded}
                    onPlayOverride={() => handlePlayTrack(t.id)}
                    selectable={isDesktop && canPersistAlbum}
                    selected={
                      typeof t.id === "number" && selectedTrackIdSet.has(t.id)
                    }
                    onSelect={(_, event) => {
                      if (typeof t.id === "number")
                        handleTrackSelection(t.id, event);
                    }}
                    onSelectionActionMenuOpen={(_, event) =>
                      typeof t.id === "number"
                        ? handleSelectionActionMenuOpen(t.id, event)
                        : false
                    }
                  />
                </div>
              );
            })}
      </div>
    </div>
  );
}
