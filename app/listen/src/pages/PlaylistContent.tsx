import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Sparkles, Globe, Lock, Users } from "@crate/ui/icons";

import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";

import { PlaylistCollaboratorsModal } from "@/components/playlists/PlaylistCollaboratorsModal";
import { PlaylistDeleteModal } from "@/components/playlists/PlaylistDeleteModal";
import { PlaylistTrackList } from "@/components/playlists/PlaylistTrackList";
import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";
import {
  PlaylistCreateModal,
  type PlaylistComposerTrack,
} from "@/components/playlists/PlaylistCreateModal";
import { PlaylistHeroSection } from "@/components/playlists/PlaylistHeroSection";
import { PlaylistTrackFilterBar } from "@/components/playlists/PlaylistTrackFilterBar";
import type { AuthUser } from "@/contexts/auth-context";
import { canManage } from "@/lib/collaboration-access";
import type { PlaylistData } from "@/pages/playlist-types";
import type { PlaylistPageController } from "@/pages/use-playlist-page-controller";

type LoadedPlaylistPageController = Omit<PlaylistPageController, "data"> & {
  data: PlaylistData;
};

function PlaylistBadges({
  data,
  offlineState,
  t,
}: {
  data: PlaylistData;
  offlineState: LoadedPlaylistPageController["offlineState"];
  t: LoadedPlaylistPageController["t"];
}) {
  return (
    <>
      <OfflineBadge state={offlineState} />
      {data.is_smart ? (
        <InfoBadge icon={Sparkles}>{t("playlist.badges.smart")}</InfoBadge>
      ) : null}
      <InfoBadge icon={data.visibility === "public" ? Globe : Lock}>
        {data.visibility === "public"
          ? t("playlist.visibility.public")
          : t("playlist.visibility.private")}
      </InfoBadge>
      {data.is_collaborative ? (
        <InfoBadge icon={Users}>{t("playlist.badges.collaborative")}</InfoBadge>
      ) : null}
    </>
  );
}

export function PlaylistContent({
  page,
  user,
}: {
  page: LoadedPlaylistPageController;
  user: AuthUser | null;
}) {
  const { data } = page;
  const artworkTracks = page.playlistArtworkTracks as PlaylistArtworkTrack[];

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <PlaylistHeroSection
        title={data.name}
        subtitle={
          data.visibility === "public"
            ? page.t("playlist.visibility.publicPlaylist")
            : page.t("playlist.visibility.privatePlaylist")
        }
        description={data.description}
        metaItems={page.playlistMetaItems}
        badges={
          <PlaylistBadges
            data={data}
            offlineState={page.offlineState}
            t={page.t}
          />
        }
        artwork={(className) => (
          <PlaylistArtwork
            name={data.name}
            coverDataUrl={data.cover_data_url}
            tracks={artworkTracks}
            className={className}
          />
        )}
        menuImageUrl={data.cover_data_url}
        menuImageAlt={data.name}
        onPlay={page.handlePlay}
        onShuffle={page.handleShuffle}
        playDisabled={page.playerTracks.length === 0}
        shuffleDisabled={page.playerTracks.length === 0}
        secondaryActions={page.secondaryActions}
        menuItems={page.playlistMenuItems}
      />

      <div className="mx-auto w-full max-w-content space-y-6 px-4 pb-8 sm:px-6">
        {page.offlineStatusDetail ? (
          <p className="text-xs text-text-muted">{page.offlineStatusDetail}</p>
        ) : null}
        <PlaylistTrackFilterBar
          query={page.filterQuery}
          onQueryChange={page.setFilterQuery}
          totalCount={data.tracks.length}
          filteredCount={page.filteredTracks.length}
        />
        {data.tracks.length === 0 ? (
          <EmptyState message={page.t("playlist.empty.noTracks")} />
        ) : page.filteredTracks.length === 0 ? (
          <EmptyState message={page.t("playlist.empty.noFilter")} />
        ) : (
          <PlaylistTrackList
            filteredTracks={page.filteredTracks}
            onActionMenuOpen={page.ensurePlaylistOptionsLoaded}
            onAddToPlaylist={page.handleAddTrackToPlaylist}
            onCreatePlaylist={page.handleCreatePlaylistFromTrack}
            onPlayTrack={page.handlePlayTrack}
            playlistOptions={page.destinationPlaylistOptions}
          />
        )}
      </div>

      <PlaylistCreateModal
        open={page.editorOpen}
        mode="edit"
        editorIdentity={data.id}
        initialName={data.name}
        initialDescription={data.description}
        initialCoverDataUrl={data.cover_data_url}
        initialVisibility={data.visibility || "private"}
        initialCollaborative={Boolean(data.is_collaborative)}
        canManageSettings={canManage(data)}
        initialTracks={page.editableTracks as PlaylistComposerTrack[]}
        submitting={page.saving}
        onClose={() => page.setEditorOpen(false)}
        onSubmit={page.handleSavePlaylist}
      />

      <PlaylistDeleteModal
        open={page.deleteOpen}
        deleting={page.deleting}
        name={data.name}
        onClose={() => page.setDeleteOpen(false)}
        onDelete={() => void page.handleDeletePlaylist()}
        t={page.t}
      />

      <PlaylistCollaboratorsModal
        open={page.membersOpen}
        data={data}
        members={page.members}
        user={user}
        leaving={page.leaving}
        removingMemberId={page.removingMemberId}
        onClose={() => page.setMembersOpen(false)}
        onAddMember={page.handleAddMember}
        onLeave={() => void page.handleLeave()}
        onRemoveMember={(memberUserId) =>
          void page.handleRemoveMember(memberUserId)
        }
        t={page.t}
      />
    </div>
  );
}
