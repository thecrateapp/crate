import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AppPopover, AppPopoverDivider } from "@crate/ui/primitives/AppPopover";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { Button } from "@crate/ui/shadcn/button";
import { CRATE_ICON_SIZE, ListPlus, X } from "@crate/ui/icons";
export function AlbumSelectionToolbar({
  selectedCount,
  playlists,
  selectionPlaylistPickerOpen,
  selectionBarRef,
  onToggleSelectionPlaylistPicker,
  onCreatePlaylistFromSelection,
  onAddSelectedToPlaylist,
  onClearSelection,
}: {
  selectedCount: number;
  playlists: { id: number; name: string }[];
  selectionPlaylistPickerOpen: boolean;
  selectionBarRef?: RefObject<HTMLDivElement | null>;
  onToggleSelectionPlaylistPicker: () => void;
  onCreatePlaylistFromSelection: () => void;
  onAddSelectedToPlaylist: (id: number) => Promise<void>;
  onClearSelection: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      ref={selectionBarRef}
      className="mb-3 flex flex-wrap items-center gap-3 rounded-panel border border-border-quiet bg-surface-container p-3"
    >
      <div className="mr-auto min-w-0 px-1">
        <p className="text-sm font-semibold text-text-primary">
          {t("common.selectedCount", { count: selectedCount })}
        </p>
        <p className="text-xs text-text-muted">
          {t("album.selection.doubleClickHint")}
        </p>
      </div>
      <div className="relative">
        <Button variant="outline" onClick={onToggleSelectionPlaylistPicker}>
          <ListPlus size={CRATE_ICON_SIZE.xs} />
          {t("playlist.actions.addToPlaylist")}
        </Button>
        {selectionPlaylistPickerOpen ? (
          <AppPopover className="absolute top-full right-0 z-app-popover mt-2 w-64 overflow-hidden rounded-panel">
            <div className="p-1.5">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={onCreatePlaylistFromSelection}
              >
                {t("playlist.actions.addNew")}
              </Button>
              {playlists.length > 0 ? (
                <AppPopoverDivider className="mx-1" />
              ) : null}
              {playlists.map((playlist) => (
                <Button
                  key={playlist.id}
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => void onAddSelectedToPlaylist(playlist.id)}
                >
                  {playlist.name}
                </Button>
              ))}
            </div>
          </AppPopover>
        ) : null}
      </div>
      <Button variant="outline" onClick={onCreatePlaylistFromSelection}>
        {t("playlist.actions.create")}
      </Button>
      <ActionButton
        label={t("album.selection.clear")}
        onClick={onClearSelection}
      >
        <X size={CRATE_ICON_SIZE.lg} />
      </ActionButton>
    </div>
  );
}
