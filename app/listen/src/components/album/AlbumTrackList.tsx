import type { RefObject, MouseEvent } from "react";
import type { TFunction } from "i18next";

import { AppPopover, AppPopoverDivider } from "@crate/ui/primitives/AppPopover";
import { CRATE_ICON_SIZE, Disc, ListPlus, X } from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { Button } from "@crate/ui/shadcn/button";

import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/components/actions/ItemActionMenu";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import type { PlaylistOption } from "@/contexts/PlaylistComposerContext";
import type { UseContextMenuControllerReturn } from "@crate/ui/domain/actions";

import type { AlbumData, AlbumTrack } from "@/pages/album-types";

interface AlbumTrackListProps {
  data: AlbumData;
  coverUrl: string;
  selectedTrackIds: number[];
  selectedAlbumTracks: AlbumTrack[];
  isDesktop: boolean;
  canPersistAlbum: boolean;
  playlists: PlaylistOption[];
  selectionPlaylistPickerOpen: boolean;
  selectionMenuController: UseContextMenuControllerReturn<HTMLButtonElement>;
  selectionMenuItems: ContextMenuEntry[];
  selectionBarRef: RefObject<HTMLDivElement | null>;
  onToggleSelectionPlaylistPicker: () => void;
  onCreatePlaylistFromSelection: () => void;
  onAddSelectedToPlaylist: (playlistId: number) => Promise<void>;
  onClearSelection: () => void;
  onCloseSelectionMenu: () => void;
  onAddTrackToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => Promise<void>;
  onCreatePlaylistFromTrack: (track: TrackRowData) => void;
  onActionMenuOpen: () => void;
  onPlayTrack: (trackId: number | string) => void;
  onTrackSelection: (
    trackId: number,
    event: MouseEvent<HTMLDivElement>,
  ) => void;
  onSelectionActionMenuOpen: (
    trackId: number,
    event: MouseEvent<HTMLButtonElement>,
  ) => boolean;
  trackPreviewId: (track: AlbumTrack) => string | undefined;
  sharedTrackClass: (track: AlbumTrack) => string;
  albumTrackRowData: (track: AlbumTrack, fallbackIndex: number) => TrackRowData;
  t: TFunction;
}

export function AlbumTrackList({
  data,
  coverUrl,
  selectedTrackIds,
  selectedAlbumTracks,
  isDesktop,
  canPersistAlbum,
  playlists,
  selectionPlaylistPickerOpen,
  selectionMenuController,
  selectionMenuItems,
  selectionBarRef,
  onToggleSelectionPlaylistPicker,
  onCreatePlaylistFromSelection,
  onAddSelectedToPlaylist,
  onClearSelection,
  onCloseSelectionMenu,
  onAddTrackToPlaylist,
  onCreatePlaylistFromTrack,
  onActionMenuOpen,
  onPlayTrack,
  onTrackSelection,
  onSelectionActionMenuOpen,
  trackPreviewId,
  sharedTrackClass,
  albumTrackRowData,
  t,
}: AlbumTrackListProps) {
  const selectedTrackIdSet = new Set(selectedTrackIds);
  const tracksByDisc = new Map<number, AlbumTrack[]>();
  for (const track of data.tracks) {
    const disc = parseInt(track.tags.discnumber) || 1;
    const tracks = tracksByDisc.get(disc) || [];
    tracks.push(track);
    tracksByDisc.set(disc, tracks);
  }
  const hasMultipleDiscs = tracksByDisc.size > 1;

  const renderTrack = (track: AlbumTrack, index: number) => {
    const rowTrack = albumTrackRowData(track, index);
    return (
      <div
        key={track.id}
        id={trackPreviewId(track)}
        className={sharedTrackClass(track)}
      >
        <TrackRow
          track={rowTrack}
          index={parseInt(track.tags.tracknumber) || index + 1}
          albumCover={coverUrl}
          playlistOptions={playlists}
          onAddToPlaylist={onAddTrackToPlaylist}
          onCreatePlaylist={onCreatePlaylistFromTrack}
          onActionMenuOpen={onActionMenuOpen}
          onPlayOverride={() => onPlayTrack(track.id)}
          selectable={isDesktop && canPersistAlbum}
          selected={
            typeof track.id === "number" && selectedTrackIdSet.has(track.id)
          }
          onSelect={(_, event) => {
            if (typeof track.id === "number") onTrackSelection(track.id, event);
          }}
          onSelectionActionMenuOpen={(_, event) =>
            typeof track.id === "number"
              ? onSelectionActionMenuOpen(track.id, event)
              : false
          }
        />
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 pb-8 sm:px-6">
      {isDesktop && selectedAlbumTracks.length > 0 ? (
        <div
          ref={selectionBarRef}
          className="listen-glass-panel mb-3 flex flex-wrap items-center gap-2 rounded-lg p-3 "
        >
          <div className="mr-auto min-w-0 px-1">
            <p className="text-sm font-semibold text-text-primary">
              {t("common.selectedCount", { count: selectedAlbumTracks.length })}
            </p>
            <p className="text-xs text-text-muted">
              {t("album.selection.doubleClickHint")}
            </p>
          </div>
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              shape="pill"
              className="h-9 text-xs"
              onClick={onToggleSelectionPlaylistPicker}
            >
              <ListPlus size={CRATE_ICON_SIZE.xs} />
              {t("playlist.actions.addToPlaylist")}
            </Button>
            {selectionPlaylistPickerOpen ? (
              <AppPopover className="absolute top-full right-0 z-app-popover mt-2 w-64 overflow-hidden rounded-[12px]">
                <div className="p-1.5">
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-text-primary/5"
                    onClick={onCreatePlaylistFromSelection}
                  >
                    {t("playlist.actions.addNew")}
                  </button>
                  {playlists.length > 0 ? (
                    <AppPopoverDivider className="mx-1" />
                  ) : null}
                  {playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-text-primary/5 hover:text-text-primary"
                      onClick={() => void onAddSelectedToPlaylist(playlist.id)}
                    >
                      {playlist.name}
                    </button>
                  ))}
                </div>
              </AppPopover>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            shape="pill"
            className="h-9 text-xs"
            onClick={onCreatePlaylistFromSelection}
          >
            {t("playlist.actions.create")}
          </Button>
          <IconButton
            label={t("album.selection.clear")}
            variant="card"
            size="sm"
            className="size-9"
            onClick={onClearSelection}
          >
            <X size={CRATE_ICON_SIZE.xs} />
          </IconButton>
        </div>
      ) : null}

      <ContextMenu
        items={selectionMenuItems}
        menuRef={selectionMenuController.menuRef}
        onClose={onCloseSelectionMenu}
        open={selectionMenuController.open && selectedAlbumTracks.length > 0}
        position={selectionMenuController.position}
      />
      {hasMultipleDiscs
        ? [...tracksByDisc.entries()]
            .sort(([a], [b]) => a - b)
            .map(([disc, tracks]) => (
              <div key={disc} className="mb-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
                  <Disc size={12} />
                  {t("album.disc", { disc })}
                </div>
                {tracks.map(renderTrack)}
              </div>
            ))
        : data.tracks.map(renderTrack)}
    </div>
  );
}
