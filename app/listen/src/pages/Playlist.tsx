import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Play,
  Shuffle,
  Loader2,
  Sparkles,
  RefreshCw,
  Pencil,
  Trash2,
  Share2,
  Radio,
  Users,
  Copy,
  UserMinus,
} from "@crate/ui/icons";
import type { ContextMenuEntry } from "@crate/ui/domain/actions";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CrateLoader } from "@/components/ui/CrateLoader";
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
import {
  PlaylistCreateModal,
  type PlaylistComposerTrack,
} from "@/components/playlists/PlaylistCreateModal";
import {
  AppModal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalCloseButton,
} from "@crate/ui/primitives/AppModal";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import { useAuth } from "@/contexts/AuthContext";
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
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { WindowVirtualList } from "@/components/ui/WindowVirtualList";

interface PlaylistTrack {
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

interface PlaylistData {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  visibility?: "public" | "private";
  is_collaborative?: boolean;
  user_id: number;
  is_smart: boolean;
  smart_rules?: unknown;
  track_count: number;
  total_duration: number;
  created_at: string;
  updated_at: string;
  artwork_tracks?: PlaylistArtworkTrack[];
  members?: PlaylistMember[];
  tracks: PlaylistTrack[];
}

interface PlaylistMember {
  playlist_id: number;
  user_id: number;
  role: "owner" | "collab";
  invited_by?: number | null;
  created_at: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
}

interface PlaylistInvite {
  token: string;
  join_url: string;
  qr_value: string;
  expires_at?: string | null;
}

export function Playlist() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const { data, loading, refetch } = useApi<PlaylistData>(
    id ? `/api/playlists/${id}` : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const { playlistOptions, ensurePlaylistOptionsLoaded } =
    useLazyPlaylistOptions();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const {
    supported: offlineSupported,
    getPlaylistState,
    getPlaylistRecord,
    togglePlaylistOffline,
  } = useOffline();
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteData, setInviteData] = useState<PlaylistInvite | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
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

  const members = data?.members || [];
  const isOwner = Boolean(
    user &&
      members.some(
        (member) => member.user_id === user.id && member.role === "owner",
      ),
  );
  const inviteLink = inviteData
    ? `${window.location.origin}${inviteData.join_url}`
    : null;
  const offlineState = getPlaylistState(data?.id);
  const offlineRecord = getPlaylistRecord(data?.id);
  const offlineBusy = isOfflineBusy(offlineState);
  const offlineProgress = offlineRecord?.trackCount
    ? `${Math.min(
        offlineRecord.readyTrackCount || 0,
        offlineRecord.trackCount,
      )}/${offlineRecord.trackCount}`
    : null;
  const offlineButtonLabel = data?.is_smart
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
  const offlineStatusDetail = data?.is_smart
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

  const editableTracks = useMemo<PlaylistComposerTrack[]>(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map((track) => ({
      title: track.title || "Unknown",
      artist: track.artist || "",
      album: track.album,
      duration: track.duration,
      path: track.track_path,
      libraryTrackId: track.track_id,
      playlistEntryId: track.id,
      playlistPosition: track.position,
    }));
  }, [data]);

  const filteredTracks = useMemo(
    () => filterPlaylistTracks(data?.tracks || [], deferredFilterQuery),
    [data?.tracks, deferredFilterQuery],
  );
  const destinationPlaylistOptions = useMemo(
    () => playlistOptions.filter((playlist) => playlist.id !== data?.id),
    [playlistOptions, data?.id],
  );

  function handlePlay() {
    if (playerTracks.length === 0) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/playlists/${data.id}` : undefined,
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
      href: `/playlists/${data.id}`,
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (playerTracks.length === 0) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/playlists/${data.id}` : undefined,
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
      url: publicShareUrl(`/playlist/${data.id}`),
    });
  }

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

  async function handleRegenerate() {
    if (!id) return;
    try {
      await api(`/api/playlists/${id}/generate`, "POST");
      toast.success("Playlist regenerated");
      refetch();
    } catch {
      toast.error("Failed to regenerate playlist");
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
    if (!id || !data) return;
    setSaving(true);
    try {
      await api(`/api/playlists/${id}`, "PUT", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
        visibility: payload.visibility,
        is_collaborative: payload.isCollaborative,
      });

      const originalByEntryId = new Map(
        editableTracks
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
            `/api/playlists/${id}/tracks/${track.playlistPosition}`,
            "DELETE",
          );
        }
      }

      const newTracks = payload.tracks.filter(
        (track) => track.playlistEntryId == null && hasTrackReference(track),
      );
      if (newTracks.length > 0) {
        await api(`/api/playlists/${id}/tracks`, "POST", {
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
      setEditorOpen(false);
      refetch();
    } catch {
      toast.error("Failed to update playlist");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!id) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${id}`, "DELETE");
      toast.success("Playlist deleted");
      navigate("/library?tab=playlists");
    } catch {
      toast.error("Failed to delete playlist");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function handleCreateCollaboratorInvite() {
    if (!data) return;
    setCreatingInvite(true);
    try {
      const invite = await api<PlaylistInvite>(
        `/api/playlists/${data.id}/invites`,
        "POST",
        {},
      );
      setInviteData(invite);
      toast.success("Collaborator invite created");
    } catch {
      toast.error("Failed to create playlist invite");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy invite link");
    }
  }

  async function handleRemoveMember(memberUserId: number) {
    if (!data) return;
    setRemovingMemberId(memberUserId);
    try {
      await api(`/api/playlists/${data.id}/members/${memberUserId}`, "DELETE");
      toast.success("Collaborator removed");
      refetch();
    } catch {
      toast.error("Failed to remove collaborator");
    } finally {
      setRemovingMemberId(null);
    }
  }

  if (loading) {
    return <CrateLoader label="Loading playlist." />;
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Playlist not found</p>
      </div>
    );
  }

  const playlistArtworkTracks = data.artwork_tracks ?? data.tracks;
  const playlistMetaItems = [
    `${data.track_count} track${data.track_count !== 1 ? "s" : ""}`,
    data.total_duration > 0 ? formatTotalDuration(data.total_duration) : null,
  ];
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
    ...(data.is_collaborative
      ? [
          {
            key: "collaborators",
            label: "Collabs",
            ariaLabel: "Collaborators",
            icon: Users,
            onClick: () => setMembersOpen(true),
          } satisfies PlaylistHeroSecondaryAction,
        ]
      : []),
    {
      key: "edit",
      label: "Edit",
      ariaLabel: "Edit",
      icon: Pencil,
      onClick: () => setEditorOpen(true),
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
      key: "playlist-state-divider",
    },
    {
      key: "offline",
      label: offlineButtonLabel,
      icon: offlineIcon,
      active: offlineState === "ready",
      disabled: !offlineSupported || data.is_smart || offlineBusy,
      onSelect: handleToggleOffline,
    },
    ...(data.is_collaborative
      ? [
          {
            key: "collaborators",
            label: "Collaborators",
            icon: Users,
            onSelect: () => setMembersOpen(true),
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      key: "edit",
      label: "Edit playlist",
      icon: Pencil,
      onSelect: () => setEditorOpen(true),
    },
    ...(data.is_smart
      ? [
          {
            key: "regenerate",
            label: "Regenerate playlist",
            icon: RefreshCw,
            onSelect: handleRegenerate,
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      key: "share",
      label: "Share playlist",
      icon: Share2,
      onSelect: handleShare,
    },
    {
      type: "divider",
      key: "playlist-danger-divider",
    },
    {
      key: "delete",
      label: "Delete playlist",
      icon: Trash2,
      danger: true,
      onSelect: () => setDeleteOpen(true),
    },
  ];

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <PlaylistHeroSection
        title={data.name}
        subtitle={
          data.visibility === "public" ? "Public playlist" : "Private playlist"
        }
        description={data.description}
        metaItems={playlistMetaItems}
        badges={
          <>
            <OfflineBadge state={offlineState} />
            {data.is_smart ? (
              <span className="inline-flex items-center rounded-md border border-primary/30 px-1.5 py-0 text-[10px] font-medium text-primary">
                <Sparkles size={10} className="mr-0.5" />
                Smart
              </span>
            ) : null}
            <span className="inline-flex items-center rounded-md border border-white/10 px-1.5 py-0 text-[10px] font-medium text-white/60">
              {data.visibility === "public" ? "Public" : "Private"}
            </span>
            {data.is_collaborative ? (
              <span className="inline-flex items-center rounded-md border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0 text-[10px] font-medium text-cyan-300">
                Collaborative
              </span>
            ) : null}
          </>
        }
        artwork={(className) => (
          <PlaylistArtwork
            name={data.name}
            coverDataUrl={data.cover_data_url}
            tracks={playlistArtworkTracks}
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

        {/* Track list */}
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
          <WindowVirtualList
            items={filteredTracks}
            estimateSize={72}
            itemKey={(t) => t.id ?? `${t.track_path}-${t.position}`}
            renderItem={(t, i) => (
              <TrackRow
                track={toTrackRowData({
                  ...t,
                  id: t.track_id ?? t.track_path ?? t.title,
                  library_track_id: t.track_id,
                })}
                index={i + 1}
                showCoverThumb
                showArtist
                showAlbum
                playlistOptions={destinationPlaylistOptions}
                onAddToPlaylist={handleAddTrackToPlaylist}
                onCreatePlaylist={handleCreatePlaylistFromTrack}
                onActionMenuOpen={ensurePlaylistOptionsLoaded}
                onPlayOverride={() => handlePlayTrack(t.id)}
              />
            )}
          />
        )}
      </div>

      <PlaylistCreateModal
        open={editorOpen}
        mode="edit"
        initialName={data.name}
        initialDescription={data.description}
        initialCoverDataUrl={data.cover_data_url}
        initialVisibility={data.visibility || "private"}
        initialCollaborative={Boolean(data.is_collaborative)}
        initialTracks={editableTracks}
        submitting={saving}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleSavePlaylist}
      />

      <AppModal
        open={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
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
            onClick={() => setDeleteOpen(false)}
            disabled={deleting}
          />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <p className="text-sm text-muted-foreground">
            Delete{" "}
            <span className="text-foreground font-medium">{data.name}</span> and
            remove all its track entries?
          </p>
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
          <button
            type="button"
            className="rounded-xl px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            onClick={() => setDeleteOpen(false)}
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

      <AppModal
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        maxWidthClassName="sm:max-w-lg"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Collaborators
            </h2>
            <p className="text-xs text-muted-foreground">
              {data.is_collaborative
                ? "Share a private invite link and manage the people who can edit this playlist."
                : "This playlist is not collaborative yet."}
            </p>
          </div>
          <ModalCloseButton onClick={() => setMembersOpen(false)} />
        </ModalHeader>
        <ModalBody className="space-y-5 px-5 py-5">
          {data.is_collaborative && isOwner ? (
            <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Invite a collaborator
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Owners can create share links and QR codes for private
                    beta-style collaboration.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreateCollaboratorInvite}
                  disabled={creatingInvite}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {creatingInvite ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Users size={15} />
                  )}
                  Create invite
                </button>
              </div>
              {inviteLink ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-[0.9fr_1.1fr]">
                  <div className="flex justify-center">
                    <QrCodeImage
                      value={inviteLink}
                      size={160}
                      className="rounded-2xl border border-white/10 bg-[#0f1116] p-3"
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-muted-foreground break-all">
                      {inviteLink}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyInviteLink}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
                    >
                      <Copy size={15} />
                      Copy invite link
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3">
            {members.map((member) => {
              const label =
                member.display_name ||
                member.username ||
                `User ${member.user_id}`;
              const isCurrentUser = user?.id === member.user_id;
              return (
                <div
                  key={`${member.playlist_id}-${member.user_id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div className="min-w-0">
                    {member.username ? (
                      <UserProfileLink
                        username={member.username}
                        hoverClassName="block"
                        className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
                      >
                        {label}
                      </UserProfileLink>
                    ) : (
                      <div className="truncate text-sm font-medium text-foreground">
                        {label}
                      </div>
                    )}
                    <div className="truncate text-xs text-muted-foreground">
                      {member.username ? `@${member.username}` : "Profile"} ·{" "}
                      {member.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">
                      {member.role === "owner" ? "Owner" : "Collab"}
                    </div>
                    {isOwner && member.role !== "owner" && !isCurrentUser ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member.user_id)}
                        disabled={removingMemberId === member.user_id}
                        className="inline-flex items-center gap-1 rounded-full border border-red-500/20 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-60"
                      >
                        {removingMemberId === member.user_id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <UserMinus size={12} />
                        )}
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </ModalBody>
      </AppModal>
    </div>
  );
}
