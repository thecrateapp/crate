import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Disc3 } from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
  type ItemActionMenuEntry,
  type UseItemActionMenuReturn,
} from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { useTrackPlaylistActions } from "@/hooks/use-track-playlist-actions";
import type { Track } from "@/contexts/PlayerContext";

const NO_ACTIONS: ItemActionMenuEntry[] = [];

type TrackPlaylistActions = ReturnType<typeof useTrackPlaylistActions>;

export interface PlayerTrackActionMenu {
  actionMenu: UseItemActionMenuReturn;
  playlistActions: TrackPlaylistActions;
}

export function usePlayerTrackActionMenu(
  onOverlayChange?: (open: boolean) => void,
): PlayerTrackActionMenu {
  const playlistActions = useTrackPlaylistActions();
  const { onOpenChange: onPlaylistOpenChange } = playlistActions;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      onPlaylistOpenChange(open);
      onOverlayChange?.(open);
    },
    [onOverlayChange, onPlaylistOpenChange],
  );
  const actionMenu = useItemActionMenu(NO_ACTIONS, {
    hasActions: true,
    onOpenChange: handleOpenChange,
  });
  return { actionMenu, playlistActions };
}

interface PlayerTrackMenuContentProps extends PlayerTrackActionMenu {
  currentTrack: Track;
}

export function PlayerTrackMenuContent({
  actionMenu,
  currentTrack,
  playlistActions,
}: PlayerTrackMenuContentProps) {
  const { t } = useTranslation();
  const menuTrack = useMemo(
    () => trackToMenuData(currentTrack),
    [currentTrack],
  );
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: currentTrack.albumCover,
    ...playlistActions,
  });

  return (
    <ItemActionMenu
      actions={actions}
      header={{
        type: "media",
        title: currentTrack.title,
        subtitle: currentTrack.artist,
        detail: currentTrack.album,
        imageUrl: currentTrack.albumCover,
        imageAlt: currentTrack.album
          ? t("trackRow.coverAlt", { title: currentTrack.title })
          : currentTrack.title,
        imageShape: "square",
        fallbackIcon: Disc3,
      }}
      open={actionMenu.open}
      position={actionMenu.position}
      menuRef={actionMenu.menuRef}
      onClose={actionMenu.close}
    />
  );
}

interface PlayerTrackMenuProps {
  currentTrack: Track;
  onOverlayChange?: (open: boolean) => void;
  className?: string;
}

export function PlayerTrackMenu({
  currentTrack,
  onOverlayChange,
  className,
}: PlayerTrackMenuProps) {
  const { t } = useTranslation();
  const trackMenu = usePlayerTrackActionMenu(onOverlayChange);
  const { actionMenu } = trackMenu;

  return (
    <>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        expanded={actionMenu.open}
        title={t("actions.menu.more")}
        className={className ?? "shrink-0 size-8"}
      />
      {actionMenu.open ? (
        <PlayerTrackMenuContent {...trackMenu} currentTrack={currentTrack} />
      ) : null}
    </>
  );
}
