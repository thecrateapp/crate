import {
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Heart,
  HeartBold,
  Loader2,
  Play,
  Radio,
  Shuffle,
  Share2,
} from "@crate/ui/icons";
import type { ContextMenuEntry } from "@crate/ui/domain/actions";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";
import {
  PlaylistHeroSection,
  type PlaylistHeroSecondaryAction,
} from "@/components/playlists/PlaylistHeroSection";
import {
  PlaylistTrackFilterBar,
  filterPlaylistTracks,
} from "@/components/playlists/PlaylistTrackFilterBar";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { isOfflineBusy } from "@/lib/offline";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";
import { toTrackRowData } from "@/lib/track-row-data";
import { fetchPlaylistRadio } from "@/lib/radio";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { shuffleArray, formatTotalDuration } from "@/lib/utils";
import { albumCoverApiUrl } from "@/lib/library-routes";

interface CuratedPlaylistTrack {
  id: number;
  playlist_id: number;
  track_id?: number;
  track_entity_uid?: string;
  track_path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration: number;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  position: number;
  added_at: string;
}

interface CuratedPlaylistData {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  is_smart: boolean;
  is_curated: boolean;
  category?: string | null;
  track_count: number;
  total_duration: number;
  artwork_tracks?: PlaylistArtworkTrack[];
  follower_count: number;
  is_followed: boolean;
  tracks: CuratedPlaylistTrack[];
}

const VIRTUAL_TRACK_THRESHOLD = 80;
const TRACK_ROW_ESTIMATE_PX = 72;

interface CuratedTrackListProps {
  tracks: CuratedPlaylistTrack[];
  playlistOptions?: { id: number; name: string }[];
  onAddToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => void | Promise<void>;
  onCreatePlaylist: (track: TrackRowData) => void | Promise<void>;
  onActionMenuOpen: () => void;
  onPlayTrack: (trackEntryId: number) => void;
}

function CuratedTrackRow({
  track,
  index,
  playlistOptions,
  onAddToPlaylist,
  onCreatePlaylist,
  onActionMenuOpen,
  onPlayTrack,
}: CuratedTrackListProps & { track: CuratedPlaylistTrack; index: number }) {
  return (
    <TrackRow
      track={toTrackRowData({
        ...track,
        id: track.track_id ?? track.track_path ?? track.title,
        library_track_id: track.track_id,
      })}
      index={index}
      showCoverThumb
      showArtist
      showAlbum
      playlistOptions={playlistOptions}
      onAddToPlaylist={onAddToPlaylist}
      onCreatePlaylist={onCreatePlaylist}
      onActionMenuOpen={onActionMenuOpen}
      onPlayOverride={() => onPlayTrack(track.id)}
    />
  );
}

function CuratedTrackList(props: CuratedTrackListProps) {
  if (props.tracks.length < VIRTUAL_TRACK_THRESHOLD) {
    return (
      <div className="space-y-1">
        {props.tracks.map((track, index) => (
          <CuratedTrackRow
            key={track.id}
            {...props}
            track={track}
            index={index + 1}
          />
        ))}
      </div>
    );
  }

  return <VirtualizedCuratedTrackList {...props} />;
}

function VirtualizedCuratedTrackList(props: CuratedTrackListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const rowVirtualizer = useWindowVirtualizer({
    count: props.tracks.length,
    estimateSize: () => TRACK_ROW_ESTIMATE_PX,
    getItemKey: (index) => props.tracks[index]?.id ?? index,
    overscan: 12,
    scrollMargin,
  });

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return;

    const measure = () => {
      setScrollMargin(node.getBoundingClientRect().top + window.scrollY);
    };
    measure();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(node);
    window.addEventListener("resize", measure, { passive: true });

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [props.tracks.length]);

  return (
    <div
      ref={listRef}
      className="relative"
      style={{
        height: `${rowVirtualizer.getTotalSize()}px`,
        contain: "layout paint style",
      }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const track = props.tracks[virtualRow.index];
        if (!track) return null;
        return (
          <div
            key={virtualRow.key}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full pb-1"
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            <CuratedTrackRow
              {...props}
              track={track}
              index={virtualRow.index + 1}
            />
          </div>
        );
      })}
    </div>
  );
}

export function CuratedPlaylist() {
  const { id } = useParams<{ id: string }>();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const {
    supported: offlineSupported,
    getPlaylistState,
    getPlaylistRecord,
    togglePlaylistOffline,
  } = useOffline();
  const { data, loading, refetch } = useApi<CuratedPlaylistData>(
    id ? `/api/curation/playlists/${id}` : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const { playlistOptions, ensurePlaylistOptionsLoaded } =
    useLazyPlaylistOptions();
  const [togglingFollow, setTogglingFollow] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);

  const playerTracks = useMemo(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map(
      (t): Track =>
        toPlayableTrack(t, {
          cover:
            t.artist && t.album
              ? albumCoverApiUrl({
                  albumId: t.album_id,
                  albumEntityUid: t.album_entity_uid,
                  artistEntityUid: t.artist_entity_uid,
                  albumSlug: t.album_slug,
                  artistName: t.artist,
                  albumName: t.album,
                })
              : undefined,
        }),
    );
  }, [data]);

  const filteredTracks = useMemo(
    () => filterPlaylistTracks(data?.tracks || [], deferredFilterQuery),
    [data?.tracks, deferredFilterQuery],
  );

  function handlePlay() {
    if (playerTracks.length === 0) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/curation/playlists/${data.id}` : undefined,
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  function handlePlayTrack(trackEntryId: number) {
    if (!data || playerTracks.length === 0) return;
    const startIndex = data.tracks.findIndex(
      (track) => track.id === trackEntryId,
    );
    if (startIndex < 0) return;
    playAll(playerTracks, startIndex, {
      type: "playlist",
      name: data.name || "Playlist",
      href: `/curation/playlists/${data.id}`,
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (playerTracks.length === 0) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/curation/playlists/${data.id}` : undefined,
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  async function handlePlaylistRadio() {
    if (!data) return;
    try {
      const radio = await fetchPlaylistRadio({
        playlistId: data.id,
        playlistName: data.name,
      });
      if (!radio.tracks.length) {
        toast.info("Playlist radio is not available yet");
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error("Failed to start playlist radio");
    }
  }

  async function handleShare() {
    if (!data) return;
    openShareSheet({
      kind: "playlist",
      title: data.name,
      subtitle: data.description,
      imageUrl: resolveMaybeApiAssetUrl(data.cover_data_url),
      url: publicShareUrl(`/curation/playlist/${data.id}`),
    });
  }

  async function handleAddTrackToPlaylist(
    playlistId: number,
    track: TrackRowData,
  ) {
    if (!hasTrackReference(track)) return;
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [
          toTrackReferencePayload({
            ...track,
            album: track.album || "",
            duration: track.duration || 0,
          }),
        ],
      });
      toast.success("Track added to playlist");
    } catch {
      toast.error("Failed to add track to playlist");
    }
  }

  function handleCreatePlaylistFromTrack(track: TrackRowData) {
    openCreatePlaylist({
      tracks: hasTrackReference(track) ? [toPlayableTrack(track)] : [],
    });
  }

  async function handleToggleFollow() {
    if (!id || !data) return;
    setTogglingFollow(true);
    try {
      if (data.is_followed) {
        await api(`/api/curation/playlists/${id}/follow`, "DELETE");
        toast.success("Removed from your library");
      } else {
        await api(`/api/curation/playlists/${id}/follow`, "POST");
        toast.success("Added to your library");
      }
      refetch();
    } catch {
      toast.error("Failed to update playlist");
    } finally {
      setTogglingFollow(false);
    }
  }

  if (loading) {
    return <CrateLoader label="Loading playlist." />;
  }

  if (!data) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">Playlist not found</p>
      </div>
    );
  }

  const offlineState = getPlaylistState(data.id);
  const offlineRecord = getPlaylistRecord(data.id);
  const offlineBusy = isOfflineBusy(offlineState);
  const offlineProgress = offlineRecord?.trackCount
    ? `${Math.min(
        offlineRecord.readyTrackCount || 0,
        offlineRecord.trackCount,
      )}/${offlineRecord.trackCount}`
    : null;
  const offlineButtonLabel = data.is_smart
    ? "Static only"
    : offlineState === "ready"
      ? "Available offline"
      : offlineState === "error"
        ? "Retry offline"
        : offlineState === "syncing"
          ? `Syncing...${offlineProgress ? ` ${offlineProgress}` : ""}`
          : offlineBusy
            ? `Downloading...${offlineProgress ? ` ${offlineProgress}` : ""}`
            : "Make available offline";
  const offlineStatusDetail = data.is_smart
    ? "Offline mirror is only available for static playlists."
    : offlineState === "ready"
      ? offlineRecord?.trackCount
        ? `${offlineRecord.trackCount} track${
            offlineRecord.trackCount === 1 ? "" : "s"
          } available offline`
        : "Available offline"
      : offlineBusy && offlineProgress
        ? `${offlineProgress} tracks saved for offline`
        : offlineState === "error"
          ? offlineRecord?.readyTrackCount
            ? `${offlineRecord.readyTrackCount}/${offlineRecord.trackCount} tracks saved. Retry to finish the offline copy.`
            : "Offline copy failed. Retry to finish the playlist mirror."
          : null;
  async function handleToggleOffline() {
    if (!data) return;
    try {
      const result = await togglePlaylistOffline({
        playlistId: data.id,
        title: data.name,
        isSmart: data.is_smart,
      });
      toast.success(
        result === "removed"
          ? "Offline copy removed"
          : "Playlist available offline",
      );
    } catch (error) {
      toast.error((error as Error).message || "Failed to update offline copy");
    }
  }

  const offlineIcon =
    offlineState === "ready"
      ? ArrowDownToLineBold
      : offlineBusy
        ? Loader2
        : offlineState === "error"
          ? AlertCircle
          : ArrowDownToLine;
  const secondaryActions: PlaylistHeroSecondaryAction[] = [
    {
      key: "radio",
      label: "Radio",
      ariaLabel: "Playlist Radio",
      icon: Radio,
      disabled: playerTracks.length === 0,
      onClick: () => void handlePlaylistRadio(),
    },
    {
      key: "offline",
      label: "Offline",
      ariaLabel:
        offlineState === "ready"
          ? "Remove offline copy"
          : "Make available offline",
      icon: offlineIcon,
      iconClassName: offlineBusy ? "animate-spin" : undefined,
      className:
        offlineState === "ready"
          ? "text-cyan-200 drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
          : offlineBusy
            ? "text-primary"
            : offlineState === "error"
              ? "text-amber-300/90"
              : undefined,
      disabled: !offlineSupported || data.is_smart || offlineBusy,
      title: offlineButtonLabel,
      onClick: () => void handleToggleOffline(),
    },
    {
      key: "follow",
      label: data.is_followed ? "Following" : "Follow",
      ariaLabel: data.is_followed ? "Remove from your library" : "Follow",
      icon: togglingFollow ? Loader2 : data.is_followed ? HeartBold : Heart,
      iconClassName: togglingFollow ? "animate-spin" : undefined,
      active: data.is_followed,
      pulseIcon: data.is_followed,
      disabled: togglingFollow,
      onClick: () => void handleToggleFollow(),
    },
    {
      key: "share",
      label: "Share",
      ariaLabel: "Share",
      icon: Share2,
      onClick: () => void handleShare(),
    },
  ];
  const playlistMenuItems: ContextMenuEntry[] = [
    {
      key: "play",
      label: "Play playlist",
      icon: Play,
      disabled: playerTracks.length === 0,
      onSelect: handlePlay,
    },
    {
      key: "shuffle",
      label: "Shuffle playlist",
      icon: Shuffle,
      disabled: playerTracks.length === 0,
      onSelect: handleShuffle,
    },
    {
      key: "radio",
      label: "Start playlist radio",
      icon: Radio,
      disabled: playerTracks.length === 0,
      onSelect: handlePlaylistRadio,
    },
    {
      type: "divider",
      key: "curated-playlist-library-divider",
    },
    {
      key: "follow",
      label: data.is_followed
        ? "Remove from your library"
        : "Add to your library",
      icon: data.is_followed ? HeartBold : Heart,
      active: data.is_followed,
      disabled: togglingFollow,
      onSelect: handleToggleFollow,
    },
    {
      key: "offline",
      label: offlineButtonLabel,
      icon: offlineIcon,
      active: offlineState === "ready",
      disabled: !offlineSupported || data.is_smart || offlineBusy,
      onSelect: handleToggleOffline,
    },
    {
      type: "divider",
      key: "curated-playlist-share-divider",
    },
    {
      key: "share",
      label: "Share playlist",
      icon: Share2,
      onSelect: handleShare,
    },
  ];
  const playlistMetaItems = [
    `${data.track_count} track${data.track_count !== 1 ? "s" : ""}`,
    data.total_duration > 0 ? formatTotalDuration(data.total_duration) : null,
    `${data.follower_count} follower${data.follower_count !== 1 ? "s" : ""}`,
    data.category,
  ];

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <PlaylistHeroSection
        title={data.name}
        subtitle="Crate playlist"
        description={data.description}
        metaItems={playlistMetaItems}
        badges={<OfflineBadge state={offlineState} />}
        artwork={(className) => (
          <PlaylistArtwork
            name={data.name}
            coverDataUrl={data.cover_data_url}
            tracks={data.artwork_tracks}
            className={className}
          />
        )}
        menuImageUrl={data.cover_data_url}
        menuImageAlt={data.name}
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        playDisabled={playerTracks.length === 0}
        shuffleDisabled={playerTracks.length === 0}
        secondaryActions={secondaryActions}
        menuItems={playlistMenuItems}
      />

      <div className="mx-auto w-full max-w-[1480px] space-y-6 px-4 pb-8 sm:px-6">
        {offlineStatusDetail ? (
          <p className="text-xs text-muted-foreground">{offlineStatusDetail}</p>
        ) : null}

        <PlaylistTrackFilterBar
          query={filterQuery}
          onQueryChange={setFilterQuery}
          totalCount={data.tracks.length}
          filteredCount={filteredTracks.length}
        />

        {data.tracks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              This playlist has no tracks yet
            </p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              No tracks match this filter
            </p>
          </div>
        ) : (
          <CuratedTrackList
            tracks={filteredTracks}
            playlistOptions={playlistOptions}
            onAddToPlaylist={handleAddTrackToPlaylist}
            onCreatePlaylist={handleCreatePlaylistFromTrack}
            onActionMenuOpen={ensurePlaylistOptionsLoaded}
            onPlayTrack={handlePlayTrack}
          />
        )}
      </div>
    </div>
  );
}
