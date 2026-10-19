import { AlbumSelectionToolbar } from "./AlbumSelectionToolbar";
import { FormField } from "@crate/ui/primitives/FormField";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import type { RefObject, MouseEvent } from "react";
import type { TFunction } from "i18next";

import { CRATE_ICON_SIZE, Disc } from "@crate/ui/icons";

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
    <div className="mx-auto w-full max-w-content px-4 pb-8 sm:px-6">
      {isDesktop && selectedAlbumTracks.length > 0 ? (
        <AlbumSelectionToolbar
          selectedCount={selectedAlbumTracks.length}
          playlists={playlists}
          selectionPlaylistPickerOpen={selectionPlaylistPickerOpen}
          selectionBarRef={selectionBarRef}
          onToggleSelectionPlaylistPicker={onToggleSelectionPlaylistPicker}
          onCreatePlaylistFromSelection={onCreatePlaylistFromSelection}
          onAddSelectedToPlaylist={onAddSelectedToPlaylist}
          onClearSelection={onClearSelection}
        />
      ) : null}

      <ContextMenu
        items={selectionMenuItems}
        menuRef={selectionMenuController.menuRef}
        onClose={onCloseSelectionMenu}
        open={selectionMenuController.open && selectedAlbumTracks.length > 0}
        position={selectionMenuController.position}
      />
      {hasMultipleDiscs ? (
        [...tracksByDisc.entries()]
          .sort(([a], [b]) => a - b)
          .map(([disc, tracks]) => (
            <FormField
              key={disc}
              kind="group"
              className="mb-4"
              label={
                <span className="flex items-center gap-1.5">
                  <Disc size={CRATE_ICON_SIZE.micro} />
                  {t("album.disc", { disc })}
                </span>
              }
            >
              {(group) => (
                <TrackList
                  {...group}
                  items={tracks}
                  itemKey={(track) => track.id}
                  renderRow={renderTrack}
                />
              )}
            </FormField>
          ))
      ) : (
        <TrackList
          items={data.tracks}
          itemKey={(track) => track.id}
          renderRow={renderTrack}
        />
      )}
    </div>
  );
}
