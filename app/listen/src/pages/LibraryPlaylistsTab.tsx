import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Pencil, Plus, Trash2 } from "@crate/ui/icons";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { notify } from "@crate/ui/lib/notify";
import { Button } from "@crate/ui/shadcn/button";
import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import {
  PlaylistCreateModal,
  type PlaylistComposerTrack,
} from "@/components/playlists/PlaylistCreateModal";
import { api } from "@/lib/api";
import { formatTotalDuration } from "@/lib/utils";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";

import {
  playlistOwnerLabel,
  splitLibraryPlaylists,
  type CuratedPlaylist,
  type LibraryPlaylistsPageData,
  type Playlist,
  type PlaylistDetail,
} from "./library-playlists-model";

function editableTracks(playlist: PlaylistDetail): PlaylistComposerTrack[] {
  return playlist.tracks.map((track) => ({
    ...toPlayableTrack(track),
    playlistEntryId: track.id,
    playlistPosition: track.position,
  }));
}

export function LibraryPlaylistsTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
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
  const { owned, shared } = splitLibraryPlaylists(data?.playlists, user?.id);
  const followed = data?.followed_playlists ?? [];
  const followedCurated = data?.followed_curated_playlists;
  const isEmpty =
    owned.length === 0 &&
    shared.length === 0 &&
    followed.length === 0 &&
    !followedCurated?.length;

  if (loading) return <LoadingState label={t("common.loadingShort")} />;

  async function toggleSystemPlaylistFollow(playlist: CuratedPlaylist) {
    try {
      await api(`/api/curation/playlists/${playlist.id}/follow`, "DELETE");
      notify.success(t("playlist.toasts.unfollowed", { name: playlist.name }));
      refetch();
    } catch {
      notify.error(t("playlist.toasts.updateFailed"));
    }
  }

  async function unfollowPlaylist(playlist: Playlist) {
    try {
      await api(`/api/playlists/${playlist.id}/follow`, "DELETE");
      notify.success(t("playlist.toasts.unfollowed", { name: playlist.name }));
      refetch();
    } catch {
      notify.error(t("playlist.toasts.updateFailed"));
    }
  }

  function renderReadOnlyRow(playlist: Playlist, followedRow: boolean) {
    return (
      <PlaylistCard
        variant="row"
        key={`${followedRow ? "followed" : "shared"}-${playlist.id}`}
        playlistId={playlist.id}
        name={playlist.name}
        isSmart={playlist.is_smart}
        description={playlist.description}
        coverDataUrl={playlist.cover_data_url}
        tracks={playlist.artwork_tracks}
        trackCount={playlist.track_count}
        meta={playlistOwnerLabel(playlist) ?? undefined}
        href={`/playlist/${playlist.id}`}
        detailEndpoint={`/api/playlists/${playlist.id}`}
        isFollowed={followedRow || undefined}
        onToggleFollow={
          followedRow ? () => unfollowPlaylist(playlist) : undefined
        }
      />
    );
  }

  async function openPlaylistEditor(playlistId: number) {
    try {
      const detail = await api<PlaylistDetail>(`/api/playlists/${playlistId}`);
      setEditingPlaylist(detail);
    } catch {
      notify.error(t("playlist.toasts.loadFailed"));
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

      notify.success(t("playlist.toasts.updated"));
      setEditingPlaylist(null);
      refetch();
    } catch {
      notify.error(t("playlist.toasts.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!deletingPlaylist) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${deletingPlaylist.id}`, "DELETE");
      notify.success(t("playlist.toasts.deleted"));
      setDeletingPlaylist(null);
      refetch();
    } catch {
      notify.error(t("playlist.toasts.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        onClick={() => openCreatePlaylist()}
        className="library-new-playlist w-full justify-start rounded-lg bg-text-primary/5 px-4 hover:bg-text-primary/10 has-[>svg]:px-4"
      >
        <Plus size={CRATE_ICON_SIZE.sm} className="text-accent-action" />
        {t("library.playlists.new")}
      </Button>

      {isEmpty ? (
        <EmptyState
          variant="dashed"
          title={t("library.playlists.emptyTitle")}
          description={t("library.playlists.empty")}
        />
      ) : null}

      {owned.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-xs font-bold uppercase tracking-wider text-text-primary/40">
            {t("library.playlists.yours")}
          </div>
          {owned.map((pl) => (
            <PlaylistCard
              variant="row"
              key={pl.id}
              playlistId={pl.id}
              name={pl.name}
              isSmart={pl.is_smart}
              description={pl.description}
              coverDataUrl={pl.cover_data_url}
              tracks={pl.artwork_tracks}
              trackCount={pl.track_count}
              meta={
                pl.total_duration > 0
                  ? formatTotalDuration(pl.total_duration)
                  : undefined
              }
              href={`/playlist/${pl.id}`}
              detailEndpoint={`/api/playlists/${pl.id}`}
              badge={pl.is_smart ? t("playlist.badges.smart") : undefined}
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
      ) : null}

      {shared.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-xs font-bold uppercase tracking-wider text-text-primary/40">
            {t("library.playlists.shared")}
          </div>
          {shared.map((playlist) => renderReadOnlyRow(playlist, false))}
        </div>
      ) : null}

      {followed.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-xs font-bold uppercase tracking-wider text-text-primary/40">
            {t("library.playlists.followed")}
          </div>
          {followed.map((playlist) => renderReadOnlyRow(playlist, true))}
        </div>
      ) : null}

      {followedCurated && followedCurated.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-xs font-bold uppercase tracking-wider text-text-primary/40">
            {t("explore.fromCrate.title")}
          </div>
          {followedCurated.map((playlist) => (
            <PlaylistCard
              variant="row"
              key={`curated-${playlist.id}`}
              playlistId={playlist.id}
              name={playlist.name}
              isSmart={playlist.is_smart}
              description={playlist.description}
              coverDataUrl={playlist.cover_data_url}
              tracks={playlist.artwork_tracks}
              trackCount={playlist.track_count}
              meta={[
                playlist.category,
                playlist.follower_count > 0
                  ? t("common.followerCountLabel", {
                      count: playlist.follower_count,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              href={`/curation/playlist/${playlist.id}`}
              detailEndpoint={`/api/curation/playlists/${playlist.id}`}
              crateManaged
              systemPlaylist
              isFollowed
              onToggleFollow={() => toggleSystemPlaylistFollow(playlist)}
            />
          ))}
        </div>
      ) : null}

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

      <ConfirmDialog
        open={!!deletingPlaylist}
        tone="danger"
        pending={deleting}
        title={t("playlist.delete.title")}
        description={t("playlist.delete.subtitle")}
        body={
          <>
            {t("playlist.delete.confirmPrefix")}{" "}
            <span className="font-medium text-text-primary">
              {deletingPlaylist?.name}
            </span>{" "}
            {t("playlist.delete.confirmSuffix")}
          </>
        }
        confirmLabel={t("playlist.delete.title")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        backdropLabel={t("common.closeDialog")}
        onCancel={() => setDeletingPlaylist(null)}
        onConfirm={handleDeletePlaylist}
      />
    </div>
  );
}
