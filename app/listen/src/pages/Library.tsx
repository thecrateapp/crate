import {
  type ComponentType,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Heart,
  Users,
  Disc,
  ListMusic,
  Loader2,
  Play,
  Pencil,
  Trash2,
  Search,
  Check,
  ChevronDown,
} from "@crate/ui/icons";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { PullIndicator } from "@crate/ui/primitives/PullIndicator";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { PlaylistListRow } from "@/components/playlists/PlaylistListRow";
import {
  PlaylistCreateModal,
  type PlaylistComposerTrack,
} from "@/components/playlists/PlaylistCreateModal";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { formatTotalDuration } from "@/lib/utils";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";
import { toTrackRowData } from "@/lib/track-row-data";
import { WindowVirtualList } from "@/components/ui/WindowVirtualList";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";

import { LibraryBandcampTab } from "./LibraryBandcampTab";
import { LibraryContributionsTab } from "./LibraryContributionsTab";
import { EmptyState, Spinner, StatBox } from "./LibraryPrimitives";

type Tab =
  | "playlists"
  | "artists"
  | "albums"
  | "liked"
  | "bandcamp"
  | "contributions";

type TabIcon = ComponentType<{ size?: number; className?: string }>;
type ArtistSort = "recent" | "name" | "popularity";
type AlbumSort = "recent" | "name" | "artist" | "year";
type LikedSort = "recent" | "title" | "artist" | "album";

interface MeStats {
  followed_artists: number;
  saved_albums: number;
  liked_tracks: number;
  playlists: number;
}

interface Playlist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  is_smart: boolean;
  visibility?: "public" | "private";
  is_collaborative?: boolean;
  total_duration: number;
  created_at: string;
}

interface PlaylistTrack {
  id: number;
  track_id?: number;
  global_track_uid?: string;
  globalTrackUid?: string;
  track_entity_uid?: string;
  track_path?: string | null;
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
}

interface PlaylistDetail extends Playlist {
  tracks: PlaylistTrack[];
}

interface CuratedPlaylist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_smart: boolean;
  category?: string | null;
}

interface LibraryPlaylistsPageData {
  playlists: Playlist[];
  followed_curated_playlists: CuratedPlaylist[];
}

interface FollowedArtist {
  artist_name: string;
  artist_id?: number;
  global_artist_uid?: string;
  artist_entity_uid?: string;
  artist_slug?: string;
  created_at: string;
  album_count: number;
  track_count: number;
  has_photo: boolean;
  photo_url?: string | null;
}

interface SavedAlbum {
  saved_at: string;
  id?: number | null;
  global_album_uid?: string;
  album_entity_uid?: string;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  name: string;
  year: string;
  has_cover: boolean;
  cover_url?: string | null;
  track_count: number;
  total_duration: number;
}

const tabs: { key: Tab; labelKey: string; icon: TabIcon }[] = [
  { key: "playlists", labelKey: "nav.collection.playlists", icon: ListMusic },
  { key: "artists", labelKey: "nav.collection.artists", icon: Users },
  { key: "albums", labelKey: "nav.collection.albums", icon: Disc },
  { key: "liked", labelKey: "library.tabs.liked", icon: Heart },
  { key: "bandcamp", labelKey: "nav.collection.bandcamp", icon: BandcampLogo },
  {
    key: "contributions",
    labelKey: "nav.collection.contributions",
    icon: Plus,
  },
];

const tabTitleKeys: Record<Tab, string> = {
  playlists: "nav.collection",
  artists: "nav.collection.artists",
  albums: "nav.collection.albums",
  liked: "nav.collection.likedTracks",
  bandcamp: "nav.collection.bandcamp",
  contributions: "nav.collection.contributions",
};

const artistSortOptions: { value: ArtistSort; labelKey: string }[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "name", labelKey: "common.name" },
  { value: "popularity", labelKey: "library.sort.popularity" },
];

const albumSortOptions: { value: AlbumSort; labelKey: string }[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "name", labelKey: "common.name" },
  { value: "artist", labelKey: "common.artist" },
  { value: "year", labelKey: "library.sort.year" },
];

const likedSortOptions: { value: LikedSort; labelKey: string }[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "title", labelKey: "library.sort.title" },
  { value: "artist", labelKey: "common.artist" },
  { value: "album", labelKey: "common.album" },
];

function parseTab(value: string | null): Tab {
  if (
    value === "artists" ||
    value === "albums" ||
    value === "liked" ||
    value === "bandcamp" ||
    value === "contributions"
  )
    return value;
  return "playlists";
}

function CollectionSortDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; labelKey: string }[];
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useDismissibleLayer({
    active: open,
    refs: [rootRef],
    onDismiss: () => setOpen(false),
  });

  if (!selected) return null;
  const selectedLabel = t(selected.labelKey);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t("library.sort.selectedAria", {
          label,
          value: selectedLabel,
        })}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`listen-glass-panel flex h-10 min-w-[172px] items-center justify-between gap-3 rounded-lg border border-border-quiet/10 px-4 text-sm font-semibold text-text-primary transition-[border-color,box-shadow,filter,transform] hover:-translate-y-px hover:border-accent-action/40 hover:shadow-accent-action-soft focus-visible:border-accent-action/70 focus-visible:outline-none focus-visible:shadow-accent-action ${
          open ? "border-accent-action/45 shadow-accent-action" : ""
        }`}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-text-primary/55 transition-transform ${
            open ? "rotate-180 text-accent-action" : ""
          }`}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="listen-glass-panel absolute right-0 top-full z-app-dropdown mt-2 w-48 overflow-hidden rounded-[12px] border border-border-quiet/10 p-1 shadow-menu animate-pop-in"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-[background-color,color,filter] ${
                  selected
                    ? "bg-accent-action/14 text-accent-action drop-shadow-accent-action"
                    : "text-text-primary hover:bg-text-primary/7 hover:text-accent-action hover:drop-shadow-accent-action-soft"
                }`}
              >
                <span>{t(option.labelKey)}</span>
                {selected ? <Check size={16} className="shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PlaylistsTab() {
  const { t } = useTranslation();
  const { data, loading, refetch } = useApi<LibraryPlaylistsPageData>(
    "/api/me/playlists-page",
  );
  const { openCreatePlaylist } = usePlaylistComposer();
  const [editingPlaylist, setEditingPlaylist] = useState<PlaylistDetail | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [deletingPlaylist, setDeletingPlaylist] = useState<Playlist | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const playlists = data?.playlists;
  const followedCurated = data?.followed_curated_playlists;

  if (loading) return <Spinner />;

  async function toggleSystemPlaylistFollow(playlist: CuratedPlaylist) {
    try {
      const method = "DELETE";
      await api(`/api/curation/playlists/${playlist.id}/follow`, method);
      toast.success(
        t("playlist.toasts.removedNamedLibrary", { name: playlist.name }),
      );
      refetch();
    } catch {
      toast.error(t("playlist.toasts.updateFailed"));
    }
  }

  async function openPlaylistEditor(playlistId: number) {
    try {
      const detail = await api<PlaylistDetail>(`/api/playlists/${playlistId}`);
      setEditingPlaylist(detail);
    } catch {
      toast.error(t("playlist.toasts.loadFailed"));
    }
  }

  async function handleSavePlaylist(payload: {
    name: string;
    description: string;
    coverDataUrl: string | null;
    visibility: "public" | "private";
    isCollaborative: boolean;
    tracks: PlaylistComposerTrack[];
  }) {
    if (!editingPlaylist) return;
    setSaving(true);
    try {
      await api(`/api/playlists/${editingPlaylist.id}`, "PUT", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
        visibility: payload.visibility,
        is_collaborative: payload.isCollaborative,
      });

      const originalByEntryId = new Map(
        editableTracks(editingPlaylist)
          .filter((track) => track.playlistEntryId != null)
          .map((track) => [track.playlistEntryId as number, track]),
      );

      const nextEntryIds = new Set(
        payload.tracks
          .map((track) => track.playlistEntryId)
          .filter((value): value is number => value != null),
      );

      const removedTracks = [...originalByEntryId.values()]
        .filter((track) => !nextEntryIds.has(track.playlistEntryId as number))
        .sort((a, b) => (b.playlistPosition || 0) - (a.playlistPosition || 0));

      for (const track of removedTracks) {
        if (track.playlistPosition != null) {
          await api(
            `/api/playlists/${editingPlaylist.id}/tracks/${track.playlistPosition}`,
            "DELETE",
          );
        }
      }

      const newTracks = payload.tracks.filter(
        (track) => track.playlistEntryId == null && hasTrackReference(track),
      );
      if (newTracks.length > 0) {
        await api(`/api/playlists/${editingPlaylist.id}/tracks`, "POST", {
          tracks: newTracks.map((track) =>
            toTrackReferencePayload({
              ...track,
              album: track.album || "",
              duration: track.duration || 0,
            }),
          ),
        });
      }

      toast.success(t("playlist.toasts.updated"));
      setEditingPlaylist(null);
      refetch();
    } catch {
      toast.error(t("playlist.toasts.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!deletingPlaylist) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${deletingPlaylist.id}`, "DELETE");
      toast.success(t("playlist.toasts.deleted"));
      setDeletingPlaylist(null);
      refetch();
    } catch {
      toast.error(t("playlist.toasts.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => openCreatePlaylist()}
        className="library-new-playlist flex w-full items-center gap-2 rounded-lg bg-text-primary/5 px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-text-primary/10"
      >
        <Plus size={16} className="text-accent-action" />
        {t("library.playlists.new")}
      </button>

      {followedCurated && followedCurated.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-primary/40">
            {t("explore.fromCrate.title")}
          </div>
          {followedCurated.map((playlist) => (
            <PlaylistListRow
              key={`curated-${playlist.id}`}
              playlistId={playlist.id}
              name={playlist.name}
              isSmart={playlist.is_smart}
              description={playlist.description}
              coverDataUrl={playlist.cover_data_url}
              artworkTracks={playlist.artwork_tracks}
              trackCount={playlist.track_count}
              meta={[
                playlist.category,
                playlist.follower_count > 0
                  ? `${playlist.follower_count} followers`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              href={`/curation/playlist/${playlist.id}`}
              detailEndpoint={`/api/curation/playlists/${playlist.id}`}
              crateManaged
              followState={{
                isFollowed: true,
                onToggle: async () => toggleSystemPlaylistFollow(playlist),
              }}
            />
          ))}
        </div>
      ) : null}

      {!playlists || playlists.length === 0 ? (
        !followedCurated || followedCurated.length === 0 ? (
          <EmptyState message={t("library.playlists.empty")} />
        ) : null
      ) : (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-primary/40">
            {t("library.playlists.yours")}
          </div>
          {playlists.map((pl) => (
            <PlaylistListRow
              key={pl.id}
              playlistId={pl.id}
              name={pl.name}
              isSmart={pl.is_smart}
              description={pl.description}
              coverDataUrl={pl.cover_data_url}
              artworkTracks={pl.artwork_tracks}
              trackCount={pl.track_count}
              meta={
                pl.total_duration > 0
                  ? formatTotalDuration(pl.total_duration)
                  : undefined
              }
              href={`/playlist/${pl.id}`}
              detailEndpoint={`/api/playlists/${pl.id}`}
              badge={pl.is_smart ? "smart" : "personal"}
              extraActions={[
                {
                  key: "edit",
                  icon: Pencil,
                  title: t("common.edit"),
                  onClick: async () => openPlaylistEditor(pl.id),
                },
                {
                  key: "delete",
                  icon: Trash2,
                  title: t("common.delete"),
                  onClick: async () => setDeletingPlaylist(pl),
                  tone: "danger",
                },
              ]}
            />
          ))}
        </div>
      )}

      <PlaylistCreateModal
        open={!!editingPlaylist}
        mode="edit"
        initialName={editingPlaylist?.name}
        initialDescription={editingPlaylist?.description}
        initialCoverDataUrl={editingPlaylist?.cover_data_url}
        initialVisibility={editingPlaylist?.visibility || "private"}
        initialCollaborative={Boolean(editingPlaylist?.is_collaborative)}
        initialTracks={editingPlaylist ? editableTracks(editingPlaylist) : []}
        submitting={saving}
        onClose={() => setEditingPlaylist(null)}
        onSubmit={handleSavePlaylist}
      />

      <AppModal
        open={!!deletingPlaylist}
        onClose={() => !deleting && setDeletingPlaylist(null)}
        maxWidthClassName="sm:max-w-md"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("playlist.delete.title")}
            </h2>
            <p className="text-xs text-text-muted">
              {t("playlist.delete.subtitle")}
            </p>
          </div>
          <ModalCloseButton
            onClick={() => setDeletingPlaylist(null)}
            disabled={deleting}
          />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <p className="text-sm text-text-muted">
            {t("playlist.delete.confirmPrefix")}{" "}
            <span className="font-medium text-text-primary">
              {deletingPlaylist?.name}
            </span>{" "}
            {t("playlist.delete.confirmSuffix")}
          </p>
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
          <button
            type="button"
            className="rounded-lg px-4 py-2.5 text-sm text-text-muted transition-colors hover:bg-text-primary/5 hover:text-text-primary"
            onClick={() => setDeletingPlaylist(null)}
            disabled={deleting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-state-danger px-4 py-2.5 text-sm font-medium text-state-danger-foreground transition-colors hover:bg-state-danger/90 disabled:opacity-50"
            onClick={handleDeletePlaylist}
            disabled={deleting}
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
            {t("playlist.delete.title")}
          </button>
        </ModalFooter>
      </AppModal>
    </div>
  );
}

function editableTracks(playlist: PlaylistDetail): PlaylistComposerTrack[] {
  return playlist.tracks.map((track) => ({
    ...toPlayableTrack(track),
    playlistEntryId: track.id,
    playlistPosition: track.position,
  }));
}

function ArtistsTab() {
  const { t } = useTranslation();
  const { data: artists, loading } = useApi<FollowedArtist[]>(
    "/api/catalog/me/artists",
  );
  const isDesktop = useIsDesktop();
  const [sort, setSort] = useState<"recent" | "name" | "popularity">("recent");

  const sortedArtists = useMemo(() => {
    if (!artists) return [];
    return [...artists].sort((a, b) => {
      if (sort === "name") {
        return a.artist_name.localeCompare(b.artist_name);
      }
      if (sort === "popularity") {
        const aScore = a.album_count * 12 + a.track_count;
        const bScore = b.album_count * 12 + b.track_count;
        return bScore - aScore || a.artist_name.localeCompare(b.artist_name);
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [artists, sort]);

  if (loading) return <Spinner />;
  if (!artists || artists.length === 0) {
    return <EmptyState message={t("library.artists.empty")} />;
  }

  return (
    <div className="space-y-4">
      {!isDesktop ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-primary/40">
            {t("library.sort.label")}
          </span>
          <CollectionSortDropdown
            label={t("library.sort.artists")}
            value={sort}
            options={artistSortOptions}
            onChange={setSort}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {sortedArtists.map((a) => (
          <ArtistCard
            key={a.global_artist_uid ?? a.artist_id ?? a.artist_name}
            name={a.artist_name}
            artistId={a.artist_id}
            artistEntityUid={a.artist_entity_uid}
            globalArtistUid={a.global_artist_uid}
            artistSlug={a.artist_slug}
            photo={a.photo_url ?? undefined}
            hasPhoto={a.has_photo}
            subtitle={t("common.albumCountLabel", { count: a.album_count })}
            layout="grid"
          />
        ))}
      </div>
    </div>
  );
}

function AlbumsTab() {
  const { t } = useTranslation();
  const { data: albums, loading } = useApi<SavedAlbum[]>(
    "/api/catalog/me/albums",
  );
  const isDesktop = useIsDesktop();
  const [sort, setSort] = useState<AlbumSort>("recent");

  const sortedAlbums = useMemo(() => {
    if (!albums) return [];
    return [...albums].sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sort === "artist") {
        return a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);
      }
      if (sort === "year") {
        return (
          Number(b.year || 0) - Number(a.year || 0) ||
          a.name.localeCompare(b.name)
        );
      }
      return new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime();
    });
  }, [albums, sort]);

  if (loading) return <Spinner />;
  if (!albums || albums.length === 0) {
    return <EmptyState message={t("library.albums.empty")} />;
  }

  return (
    <div className="space-y-4">
      {!isDesktop ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-primary/40">
            {t("library.sort.label")}
          </span>
          <CollectionSortDropdown
            label={t("library.sort.albums")}
            value={sort}
            options={albumSortOptions}
            onChange={setSort}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {sortedAlbums.map((a) => (
          <AlbumCard
            key={a.global_album_uid ?? a.id}
            artist={a.artist}
            album={a.name}
            albumId={a.id ?? undefined}
            albumEntityUid={a.album_entity_uid}
            globalAlbumUid={a.global_album_uid}
            artistEntityUid={a.artist_entity_uid}
            albumSlug={a.slug}
            year={a.year}
            cover={a.cover_url ?? undefined}
            layout="grid"
          />
        ))}
      </div>
    </div>
  );
}

function LikedTab() {
  const { t } = useTranslation();
  const { likedTracks: tracks, loading } = useLikedTracks();
  const { playAll } = usePlayerActions();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LikedSort>("recent");

  const filtered = useMemo(() => {
    if (!tracks) return [];
    let list = [...tracks];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.artist?.toLowerCase().includes(q) ||
          t.album?.toLowerCase().includes(q),
      );
    }
    if (sort === "title")
      list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    else if (sort === "artist")
      list.sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
    else if (sort === "album")
      list.sort((a, b) => (a.album || "").localeCompare(b.album || ""));
    return list;
  }, [tracks, search, sort]);

  const trackRows = useMemo<TrackRowData[]>(
    () =>
      filtered.map((t) =>
        toTrackRowData({
          ...t,
          id: t.track_id ?? t.relative_path ?? t.path ?? t.title,
          path: t.relative_path || t.path,
          library_track_id: t.track_id,
        }),
      ),
    [filtered],
  );

  if (loading) return <Spinner />;
  if (!tracks || tracks.length === 0) {
    return <EmptyState message={t("library.liked.empty")} />;
  }

  function handlePlayAll() {
    const list = filtered.length ? filtered : tracks!;
    const playerTracks: Track[] = list.map((t) =>
      toPlayableTrack(
        {
          ...t,
          id: t.track_id ?? t.relative_path ?? t.path ?? t.title,
          path: t.relative_path || t.path,
          library_track_id: t.track_id,
        },
        {
          cover:
            t.artist && t.album
              ? albumCoverApiUrl(
                  {
                    albumId: t.album_id,
                    albumEntityUid: t.album_entity_uid,
                    artistEntityUid: t.artist_entity_uid,
                    albumSlug: t.album_slug,
                    artistName: t.artist,
                    albumName: t.album,
                  },
                  { size: 512 },
                )
              : undefined,
        },
      ),
    );
    playAll(playerTracks, 0);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handlePlayAll}
          className="flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
        >
          <Play size={16} fill="currentColor" />
          {filtered.length < tracks.length
            ? t("library.liked.playFiltered", { count: filtered.length })
            : t("library.liked.playAll")}
        </button>
        <div className="relative min-w-[180px] flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-primary/40"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("library.liked.filterPlaceholder")}
            className="h-10 w-full rounded-lg bg-text-primary/5 pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-primary/40 focus:bg-text-primary/8"
          />
        </div>
        <CollectionSortDropdown
          label={t("library.sort.likedTracks")}
          value={sort}
          options={likedSortOptions}
          onChange={setSort}
        />
      </div>
      <WindowVirtualList
        items={trackRows}
        estimateSize={72}
        itemKey={(row, index) =>
          row.id ??
          row.path ??
          `${row.artist}-${row.album}-${row.title}-${index}`
        }
        renderItem={(row, i) => (
          <TrackRow
            track={row}
            index={i + 1}
            showArtist
            showAlbum
            albumCover={
              row.artist && row.album
                ? albumCoverApiUrl(
                    {
                      albumId: row.album_id,
                      albumEntityUid: row.album_entity_uid,
                      artistEntityUid: row.artist_entity_uid,
                      albumSlug: row.album_slug,
                      artistName: row.artist,
                      albumName: row.album,
                    },
                    { size: 128 },
                  )
                : undefined
            }
            showCoverThumb
            queueTracks={trackRows}
          />
        )}
      />
    </div>
  );
}

export function Library() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { section } = useParams<{ section?: string }>();
  const isDesktop = useIsDesktop();
  const { data: stats, refetch: refetchStats } = useApi<MeStats>(
    isDesktop ? "/api/me" : null,
  );
  const tab = section ? parseTab(section) : parseTab(searchParams.get("tab"));
  const [refreshKey, setRefreshKey] = useState(0);

  const onRefresh = useCallback(async () => {
    refetchStats();
    setRefreshKey((k) => k + 1);
  }, [refetchStats]);

  const {
    handlers: pullHandlers,
    pullDistance,
    refreshing,
  } = usePullToRefresh(onRefresh);

  function setTab(tab: Tab) {
    setSearchParams({ tab });
  }

  return (
    <div className="space-y-6" {...pullHandlers}>
      <PullIndicator distance={pullDistance} refreshing={refreshing} />
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          {isDesktop ? t("library.title.desktop") : t(tabTitleKeys[tab])}
        </h1>
      </div>

      {/* Stats */}
      {stats && (
        <div className="hidden gap-2 md:flex">
          <StatBox
            value={stats.followed_artists}
            label={t("nav.collection.artists")}
          />
          <StatBox
            value={stats.saved_albums}
            label={t("nav.collection.albums")}
          />
          <StatBox value={stats.liked_tracks} label={t("common.tracks")} />
          <StatBox
            value={stats.playlists}
            label={t("nav.collection.playlists")}
          />
        </div>
      )}

      {/* Tab bar */}
      {isDesktop ? (
        <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex scroll-px-4 gap-2 overflow-x-auto pr-8 transform-gpu will-change-scroll [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:pr-0">
            {tabs.map(({ key, labelKey, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex min-h-11 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  tab === key
                    ? "bg-accent-action text-accent-action-foreground"
                    : "bg-text-primary/5 text-text-muted hover:bg-text-primary/10 hover:text-text-primary"
                }`}
              >
                <Icon size={14} />
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Tab content */}
      {tab === "playlists" && <PlaylistsTab key={refreshKey} />}
      {tab === "artists" && <ArtistsTab key={refreshKey} />}
      {tab === "albums" && <AlbumsTab key={refreshKey} />}
      {tab === "liked" && <LikedTab key={refreshKey} />}
      {tab === "bandcamp" && <LibraryBandcampTab key={refreshKey} />}
      {tab === "contributions" && <LibraryContributionsTab key={refreshKey} />}
    </div>
  );
}
