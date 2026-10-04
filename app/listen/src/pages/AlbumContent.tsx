import { AlbumActionNotices } from "@/components/album/AlbumActionNotices";
import { AlbumActions } from "@/components/album/AlbumActions";
import { AlbumHero } from "@/components/album/AlbumHero";
import { AlbumTrackList } from "@/components/album/AlbumTrackList";
import { genreSlug } from "@/lib/utils";
import type { LoadedAlbumPageController } from "@/pages/use-album-page-controller";

export function AlbumContent({ page }: { page: LoadedAlbumPageController }) {
  const {
    albumHeroInfoRef,
    albumPrimaryActionsRef,
    data,
    displayName,
    globalAlbumUid,
    handleAddSelectedToPlaylist,
    handleAddTrackToPlaylist,
    handleAlbumRadio,
    handleCreatePlaylistFromSelection,
    handleCreatePlaylistFromTrack,
    handlePlay,
    handlePlayTrack,
    handleSelectionActionMenuOpen,
    handleShuffle,
    handleToggleSelectionPlaylistPicker,
    handleTrackSelection,
    isDesktop,
    isPreRelease,
    navigate,
    playerTracks,
    playlists,
    presentation,
    selectedAlbumTracks,
    selectedTrackIds,
    selectionBarRef,
    selectionMenuController,
    selectionPlaylistPickerOpen,
    ensurePlaylistOptionsLoaded,
    t,
  } = page;

  return (
    <div
      data-testid="album-shell"
      className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6"
      style={presentation.albumHeroStyle}
    >
      <AlbumHero
        data={data}
        coverUrl={presentation.coverUrl}
        artistPhotoUrl={presentation.artistPhotoUrl}
        displayName={displayName}
        isPreRelease={isPreRelease}
        canPersistAlbum={presentation.canPersistAlbum}
        offlineState={presentation.offlineState}
        year={presentation.year}
        genre={presentation.genre}
        playerTrackCount={playerTracks.length}
        qualityBadges={presentation.qualityBadges}
        visibleContributor={presentation.visibleContributor}
        primaryContributorName={presentation.primaryContributorName}
        primaryContributorPath={presentation.primaryContributorPath}
        primaryContributorSource={presentation.primaryContributorSource}
        albumHeroInfoRef={albumHeroInfoRef}
        actions={
          <AlbumActions
            data={data}
            coverUrl={presentation.coverUrl}
            displayName={displayName}
            state={{
              isPreRelease,
              canPersistAlbum: presentation.canPersistAlbum,
              canSaveAlbum: presentation.canSaveAlbum,
              offlineSupported: presentation.offlineSupported,
              offlineState: presentation.offlineState,
              offlineBusy: presentation.offlineBusy,
              offlineButtonLabel: presentation.offlineButtonLabel,
              offlineStatusDetail: presentation.offlineStatusDetail,
              saved: presentation.saved,
              remoteOnly: presentation.remoteOnly,
              playerTracksAvailable: playerTracks.length > 0,
            }}
            menuItems={presentation.albumMenuItems}
            actionsRef={albumPrimaryActionsRef}
            actions={{
              onAlbumRadio: handleAlbumRadio,
              onToggleOffline: presentation.handleToggleOffline,
              onToggleSaved: presentation.handleToggleSaved,
              onShare: presentation.handleShare,
              onPlay: handlePlay,
              onShuffle: handleShuffle,
            }}
            t={t}
          />
        }
        onArtistNavigate={presentation.handleGoToArtist}
        onGenreSelect={(item) =>
          navigate(
            `/explore?genre=${encodeURIComponent(
              item.slug || genreSlug(item.name),
            )}`,
          )
        }
        t={t}
      />
      <AlbumActionNotices
        data={data}
        globalAlbumUid={globalAlbumUid}
        state={{
          remoteOnly: presentation.remoteOnly,
          offlineStatusDetail: presentation.offlineStatusDetail,
          isPreRelease,
        }}
        t={t}
      />
      <AlbumTrackList
        data={data}
        coverUrl={presentation.coverUrl}
        selectedTrackIds={selectedTrackIds}
        selectedAlbumTracks={selectedAlbumTracks}
        isDesktop={isDesktop}
        canPersistAlbum={presentation.canPersistAlbum}
        playlists={playlists}
        selectionPlaylistPickerOpen={selectionPlaylistPickerOpen}
        selectionMenuController={selectionMenuController}
        selectionMenuItems={presentation.selectionMenuItems}
        selectionBarRef={selectionBarRef}
        onToggleSelectionPlaylistPicker={handleToggleSelectionPlaylistPicker}
        onCreatePlaylistFromSelection={handleCreatePlaylistFromSelection}
        onAddSelectedToPlaylist={handleAddSelectedToPlaylist}
        onClearSelection={page.clearTrackSelection}
        onCloseSelectionMenu={page.handleCloseSelectionMenu}
        onAddTrackToPlaylist={handleAddTrackToPlaylist}
        onCreatePlaylistFromTrack={handleCreatePlaylistFromTrack}
        onActionMenuOpen={ensurePlaylistOptionsLoaded}
        onPlayTrack={handlePlayTrack}
        onTrackSelection={handleTrackSelection}
        onSelectionActionMenuOpen={handleSelectionActionMenuOpen}
        trackPreviewId={presentation.trackPreviewId}
        sharedTrackClass={presentation.sharedTrackClass}
        albumTrackRowData={presentation.albumTrackRowData}
        t={t}
      />
    </div>
  );
}
