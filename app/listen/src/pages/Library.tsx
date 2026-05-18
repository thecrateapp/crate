import { type ComponentType, useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Plus,
  Heart,
  Users,
  Disc,
  ListMusic,
  Download,
  ExternalLink,
  Loader2,
  Play,
  Pencil,
  Trash2,
  Search,
} from "lucide-react";
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
import { api, apiAssetUrl } from "@/lib/api";
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

type Tab =
  | "playlists"
  | "artists"
  | "albums"
  | "liked"
  | "bandcamp"
  | "contributions";

type TabIcon = ComponentType<{ size?: number; className?: string }>;

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
  artist_entity_uid?: string;
  artist_slug?: string;
  created_at: string;
  album_count: number;
  track_count: number;
  has_photo: boolean;
}

interface SavedAlbum {
  saved_at: string;
  id: number;
  album_entity_uid?: string;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  name: string;
  year: string;
  has_cover: boolean;
  track_count: number;
  total_duration: number;
}

interface BandcampCollectionResponse {
  items: BandcampItem[];
  total: number;
}

interface ContributionsResponse {
  items: LibraryContribution[];
  total: number;
}

interface BandcampTaskResponse {
  task_id: string;
  status: string;
}

interface BandcampItem {
  id: number;
  bandcamp_item_id?: number | null;
  artist_name?: string | null;
  album_title?: string | null;
  track_title?: string | null;
  item_url?: string | null;
  cover_url?: string | null;
  owned?: boolean | null;
  downloadable?: boolean | null;
  latest_import_status?: string | null;
}

interface LibraryContribution {
  id: number;
  album_id?: number | null;
  album_entity_uid?: string | null;
  album_slug?: string | null;
  artist_name: string;
  album_name: string;
  source: string;
  source_ref: string;
  status: string;
  imported_at?: string | null;
  track_entity_uids?: string[];
  track_count?: number | null;
  total_duration?: number | null;
  has_cover?: boolean | null;
}

const tabs: { key: Tab; label: string; icon: TabIcon }[] = [
  { key: "playlists", label: "Playlists", icon: ListMusic },
  { key: "artists", label: "Artists", icon: Users },
  { key: "albums", label: "Albums", icon: Disc },
  { key: "liked", label: "Liked", icon: Heart },
  { key: "bandcamp", label: "Bandcamp", icon: BandcampLogo },
  { key: "contributions", label: "Contributions", icon: Plus },
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

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="text-primary animate-spin" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-white/5 px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-foreground">{value ?? 0}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function PlaylistsTab() {
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
      toast.success(`Removed ${playlist.name} from your library`);
      refetch();
    } catch {
      toast.error("Failed to update playlist");
    }
  }

  async function openPlaylistEditor(playlistId: number) {
    try {
      const detail = await api<PlaylistDetail>(`/api/playlists/${playlistId}`);
      setEditingPlaylist(detail);
    } catch {
      toast.error("Failed to load playlist");
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

      toast.success("Playlist updated");
      setEditingPlaylist(null);
      refetch();
    } catch {
      toast.error("Failed to update playlist");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!deletingPlaylist) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${deletingPlaylist.id}`, "DELETE");
      toast.success("Playlist deleted");
      setDeletingPlaylist(null);
      refetch();
    } catch {
      toast.error("Failed to delete playlist");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => openCreatePlaylist()}
        className="flex items-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors px-4 py-2.5 text-sm font-medium text-foreground w-full"
      >
        <Plus size={16} className="text-primary" />
        New Playlist
      </button>

      {followedCurated && followedCurated.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/40">
            From Crate
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
          <EmptyState message="No playlists yet. Create one to get started." />
        ) : null
      ) : (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/40">
            Your Playlists
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
                  title: "Edit",
                  onClick: async () => openPlaylistEditor(pl.id),
                },
                {
                  key: "delete",
                  icon: Trash2,
                  title: "Delete",
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
            <h2 className="text-lg font-semibold text-foreground">
              Delete playlist
            </h2>
            <p className="text-xs text-muted-foreground">
              This action cannot be undone.
            </p>
          </div>
          <ModalCloseButton
            onClick={() => setDeletingPlaylist(null)}
            disabled={deleting}
          />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <p className="text-sm text-muted-foreground">
            Delete{" "}
            <span className="font-medium text-foreground">
              {deletingPlaylist?.name}
            </span>{" "}
            and remove all its track entries?
          </p>
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
          <button
            type="button"
            className="rounded-xl px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            onClick={() => setDeletingPlaylist(null)}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500/90 transition-colors disabled:opacity-50"
            onClick={handleDeletePlaylist}
            disabled={deleting}
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
            Delete playlist
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
  const { data: artists, loading } =
    useApi<FollowedArtist[]>("/api/me/follows");

  if (loading) return <Spinner />;
  if (!artists || artists.length === 0) {
    return (
      <EmptyState message="You haven't followed any artists yet. Explore the library to find artists you love." />
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
      {artists.map((a) => (
        <ArtistCard
          key={a.artist_id ?? a.artist_name}
          name={a.artist_name}
          artistId={a.artist_id}
          artistEntityUid={a.artist_entity_uid}
          artistSlug={a.artist_slug}
          subtitle={`${a.album_count} album${a.album_count !== 1 ? "s" : ""}`}
          layout="grid"
        />
      ))}
    </div>
  );
}

function AlbumsTab() {
  const { data: albums, loading } = useApi<SavedAlbum[]>("/api/me/albums");

  if (loading) return <Spinner />;
  if (!albums || albums.length === 0) {
    return <EmptyState message="No saved albums yet." />;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
      {albums.map((a) => (
        <AlbumCard
          key={a.id}
          artist={a.artist}
          album={a.name}
          albumId={a.id}
          albumEntityUid={a.album_entity_uid}
          artistEntityUid={a.artist_entity_uid}
          albumSlug={a.slug}
          year={a.year}
          layout="grid"
        />
      ))}
    </div>
  );
}

function BandcampTab() {
  const {
    data: collection,
    loading: collectionLoading,
    refetch: refetchCollection,
  } = useApi<BandcampCollectionResponse>("/api/bandcamp/me/collection");
  const {
    data: contributions,
    loading: contributionsLoading,
    refetch: refetchContributions,
  } = useApi<ContributionsResponse>("/api/me/contributions?source=bandcamp");
  const { data: wishlist, loading: wishlistLoading } =
    useApi<BandcampCollectionResponse>("/api/bandcamp/me/wishlist");
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [withdrawTarget, setWithdrawTarget] =
    useState<LibraryContribution | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  async function importItem(item: BandcampItem) {
    const itemId = item.bandcamp_item_id ?? item.id;
    if (!itemId) return;
    setBusyItemId(item.id);
    try {
      const response = await api<BandcampTaskResponse>(
        "/api/bandcamp/me/imports",
        "POST",
        { bandcamp_item_id: itemId, format: "flac" },
      );
      toast.success(`Bandcamp import queued (${response.task_id})`);
      refetchCollection();
      refetchContributions();
    } catch (error) {
      toast.error((error as Error).message || "Failed to import Bandcamp item");
    } finally {
      setBusyItemId(null);
    }
  }

  function exportContribution(contribution: LibraryContribution) {
    window.open(
      apiAssetUrl(`/api/me/contributions/${contribution.id}/export`),
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function withdrawContribution() {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      const response = await api<BandcampTaskResponse>(
        `/api/me/contributions/${withdrawTarget.id}/withdraw`,
        "POST",
      );
      toast.success(`Bandcamp removal queued (${response.task_id})`);
      setWithdrawTarget(null);
      refetchCollection();
      refetchContributions();
    } catch (error) {
      toast.error(
        (error as Error).message || "Failed to remove Bandcamp contribution",
      );
    } finally {
      setWithdrawing(false);
    }
  }

  const purchases = collection?.items ?? [];
  const importedContributions = contributions?.items ?? [];
  const wishlistCount = wishlist?.total ?? 0;

  if (collectionLoading || wishlistLoading || contributionsLoading)
    return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-[#1da0c3]/20 bg-[#1da0c3]/10 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#1da0c3]/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-primary">
              <BandcampLogo size={13} />
              Bandcamp
            </div>
            <h2 className="mt-3 text-xl font-black text-foreground">
              Synced purchases
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sync keeps your Bandcamp purchases here. Import downloads the
              audio and adds it to your Crate library.
            </p>
          </div>
          <div className="flex gap-2">
            <StatBox value={purchases.length} label="Purchases" />
            <StatBox value={importedContributions.length} label="In Crate" />
            <StatBox value={wishlistCount} label="Wishlist" />
          </div>
        </div>
      </div>

      {importedContributions.length ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-primary">
              Imported into Crate
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Portable exports are generated with Crate metadata. Removing a
              contribution only deletes the album when nobody else owns that
              library copy.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {importedContributions.map((contribution) => (
              <article
                key={contribution.id}
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3"
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/8 bg-white/6">
                  {contribution.album_id ? (
                    <img
                      src={albumCoverApiUrl({
                        albumId: contribution.album_id,
                        albumEntityUid: contribution.album_entity_uid,
                        artistName: contribution.artist_name,
                        albumName: contribution.album_name,
                      })}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <BandcampLogo size={20} className="text-primary/70" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-black text-foreground">
                    {contribution.album_name}
                  </h4>
                  <p className="truncate text-xs text-muted-foreground">
                    {contribution.artist_name}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!contribution.album_id}
                  onClick={() => exportContribution(contribution)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-3 text-xs font-bold text-muted-foreground disabled:opacity-40"
                >
                  <Download size={14} />
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawTarget(contribution)}
                  className="inline-flex min-h-10 items-center rounded-full border border-red-400/20 px-3 text-xs font-bold text-red-300"
                >
                  <Trash2 size={14} />
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!purchases.length ? (
        <div className="space-y-3">
          <EmptyState message="No Bandcamp purchases synced yet. Connect and sync Bandcamp from Settings." />
          <Link
            to="/settings"
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-bold text-black"
          >
            Open settings
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {purchases.map((item) => (
            <article
              key={`${item.id}-${item.item_url}`}
              className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3"
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-white/6">
                {item.cover_url ? (
                  <img
                    src={item.cover_url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <BandcampLogo size={22} className="text-primary/70" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-black text-foreground">
                  {bandcampItemTitle(item)}
                </h3>
                <p className="truncate text-xs text-muted-foreground">
                  {item.artist_name || "Bandcamp"}
                </p>
              </div>
              {item.latest_import_status === "completed" ? (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">
                  Imported
                </span>
              ) : item.downloadable ? (
                <button
                  type="button"
                  disabled={busyItemId === item.id}
                  onClick={() => void importItem(item)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-3 text-xs font-black text-black disabled:opacity-50"
                >
                  {busyItemId === item.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  Import
                </button>
              ) : null}
              {item.item_url ? (
                <button
                  type="button"
                  onClick={() => window.open(item.item_url || "", "_blank")}
                  className="inline-flex min-h-10 items-center rounded-full border border-white/10 px-3 text-xs font-bold text-muted-foreground"
                >
                  <ExternalLink size={14} />
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <AppModal
        open={Boolean(withdrawTarget)}
        onClose={() => {
          if (!withdrawing) setWithdrawTarget(null);
        }}
      >
        <ModalHeader>
          <h2 className="text-lg font-black text-foreground">
            Remove Bandcamp contribution?
          </h2>
          <ModalCloseButton
            disabled={withdrawing}
            onClick={() => setWithdrawTarget(null)}
          />
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted-foreground">
            This withdraws your Bandcamp copy of{" "}
            <span className="font-bold text-foreground">
              {withdrawTarget?.album_name}
            </span>
            . If no other user owns this library copy, Crate will permanently
            remove the album files and database rows in a worker task.
          </p>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            disabled={withdrawing}
            onClick={() => setWithdrawTarget(null)}
            className="inline-flex min-h-11 items-center rounded-full border border-white/10 px-4 text-sm font-bold text-muted-foreground disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={withdrawing}
            onClick={() => void withdrawContribution()}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-red-400 px-4 text-sm font-black text-black disabled:opacity-50"
          >
            {withdrawing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : null}
            Remove contribution
          </button>
        </ModalFooter>
      </AppModal>
    </div>
  );
}

function contributionSourceLabel(source: string): string {
  if (source === "bandcamp") return "Bandcamp";
  if (source === "admin_upload") return "Admin upload";
  if (source === "listen_upload") return "Upload";
  return source || "Contribution";
}

function ContributionArtwork({
  contribution,
}: {
  contribution: LibraryContribution;
}) {
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/8 bg-white/6">
      {contribution.album_id ? (
        <img
          src={albumCoverApiUrl({
            albumId: contribution.album_id,
            albumEntityUid: contribution.album_entity_uid,
            artistName: contribution.artist_name,
            albumName: contribution.album_name,
          })}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-primary/70">
          {contribution.source === "bandcamp" ? (
            <BandcampLogo size={20} />
          ) : (
            <Plus size={20} />
          )}
        </div>
      )}
    </div>
  );
}

function ContributionsTab() {
  const {
    data,
    loading,
    refetch: refetchContributions,
  } = useApi<ContributionsResponse>("/api/me/contributions");
  const [withdrawTarget, setWithdrawTarget] =
    useState<LibraryContribution | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  if (loading) return <Spinner />;

  const contributions = data?.items ?? [];

  function exportContribution(contribution: LibraryContribution) {
    window.open(
      apiAssetUrl(`/api/me/contributions/${contribution.id}/export`),
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function withdrawContribution() {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      const response = await api<BandcampTaskResponse>(
        `/api/me/contributions/${withdrawTarget.id}/withdraw`,
        "POST",
      );
      toast.success(`Removal queued (${response.task_id})`);
      setWithdrawTarget(null);
      refetchContributions();
    } catch (error) {
      toast.error((error as Error).message || "Failed to remove contribution");
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-black text-foreground">
          Your contributions
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Albums you brought into this Crate instance. You can download a
          portable export or withdraw your contribution; the shared library copy
          is deleted only when nobody else has contributed it.
        </p>
      </div>

      {!contributions.length ? (
        <EmptyState message="You have not contributed any albums yet." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {contributions.map((contribution) => (
            <article
              key={contribution.id}
              className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3"
            >
              <ContributionArtwork contribution={contribution} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-black text-foreground">
                  {contribution.album_name}
                </h3>
                <p className="truncate text-xs text-muted-foreground">
                  {contribution.artist_name}
                </p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-primary/80">
                  {contributionSourceLabel(contribution.source)}
                </p>
              </div>
              <button
                type="button"
                disabled={!contribution.album_id}
                onClick={() => exportContribution(contribution)}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-3 text-xs font-bold text-muted-foreground disabled:opacity-40"
              >
                <Download size={14} />
                Export
              </button>
              <button
                type="button"
                onClick={() => setWithdrawTarget(contribution)}
                className="inline-flex min-h-10 items-center rounded-full border border-red-400/20 px-3 text-xs font-bold text-red-300"
              >
                <Trash2 size={14} />
              </button>
            </article>
          ))}
        </div>
      )}

      <AppModal
        open={Boolean(withdrawTarget)}
        onClose={() => {
          if (!withdrawing) setWithdrawTarget(null);
        }}
      >
        <ModalHeader>
          <h2 className="text-lg font-black text-foreground">
            Remove contribution?
          </h2>
          <ModalCloseButton
            disabled={withdrawing}
            onClick={() => setWithdrawTarget(null)}
          />
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted-foreground">
            This withdraws your contribution of{" "}
            <span className="font-bold text-foreground">
              {withdrawTarget?.album_name}
            </span>
            . If no other user contributed this library copy, Crate will
            permanently remove the album files and database rows in a worker
            task.
          </p>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            disabled={withdrawing}
            onClick={() => setWithdrawTarget(null)}
            className="inline-flex min-h-11 items-center rounded-full border border-white/10 px-4 text-sm font-bold text-muted-foreground disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={withdrawing}
            onClick={() => void withdrawContribution()}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-red-400 px-4 text-sm font-black text-black disabled:opacity-50"
          >
            {withdrawing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : null}
            Remove contribution
          </button>
        </ModalFooter>
      </AppModal>
    </div>
  );
}

function bandcampItemTitle(item: BandcampItem): string {
  return (
    item.album_title || item.track_title || item.artist_name || "Bandcamp item"
  );
}

type LikedSort = "recent" | "title" | "artist" | "album";

function LikedTab() {
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
    return (
      <EmptyState message="No liked tracks yet. Tap the heart on any track to save it here." />
    );
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
              ? albumCoverApiUrl({
                  albumId: t.album_id,
                  albumEntityUid: t.album_entity_uid,
                  artistEntityUid: t.artist_entity_uid,
                  albumSlug: t.album_slug,
                  artistName: t.artist,
                  albumName: t.album,
                })
              : undefined,
        },
      ),
    );
    playAll(playerTracks, 0);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={handlePlayAll}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Play size={16} fill="currentColor" />
          Play {filtered.length < tracks.length ? `${filtered.length}` : "All"}
        </button>
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter liked tracks..."
            className="w-full h-10 pl-9 pr-3 rounded-lg bg-white/5 text-sm text-white placeholder:text-white/40 outline-none focus:bg-white/8"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as LikedSort)}
          className="h-10 rounded-lg bg-white/5 px-3 text-sm text-white/70 outline-none"
        >
          <option value="recent">Recent</option>
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="album">Album</option>
        </select>
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
                ? albumCoverApiUrl({
                    albumId: row.album_id,
                    albumEntityUid: row.album_entity_uid,
                    artistEntityUid: row.artist_entity_uid,
                    albumSlug: row.album_slug,
                    artistName: row.artist,
                    albumName: row.album,
                  })
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
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktop = useIsDesktop();
  const { data: stats, refetch: refetchStats } = useApi<MeStats>(
    isDesktop ? "/api/me" : null,
  );
  const tab = parseTab(searchParams.get("tab"));
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
        <h1 className="text-2xl font-bold">Your Library</h1>
      </div>

      {/* Stats */}
      {stats && (
        <div className="hidden gap-2 md:flex">
          <StatBox value={stats.followed_artists} label="Artists" />
          <StatBox value={stats.saved_albums} label="Albums" />
          <StatBox value={stats.liked_tracks} label="Tracks" />
          <StatBox value={stats.playlists} label="Playlists" />
        </div>
      )}

      {/* Tab bar */}
      <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-10 bg-gradient-to-l from-[var(--surface-app)] to-transparent sm:hidden" />
        <div className="flex scroll-px-4 gap-2 overflow-x-auto pr-8 transform-gpu will-change-scroll [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:pr-0">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex min-h-11 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === "playlists" && <PlaylistsTab key={refreshKey} />}
      {tab === "artists" && <ArtistsTab key={refreshKey} />}
      {tab === "albums" && <AlbumsTab key={refreshKey} />}
      {tab === "liked" && <LikedTab key={refreshKey} />}
      {tab === "bandcamp" && <BandcampTab key={refreshKey} />}
      {tab === "contributions" && <ContributionsTab key={refreshKey} />}
    </div>
  );
}
