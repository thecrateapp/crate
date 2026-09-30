import { useCallback, useMemo } from "react";
import { Disc3 } from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { useTrackPlaylistActions } from "@/hooks/use-track-playlist-actions";
import type { Track } from "@/contexts/PlayerContext";

interface PlayerTrackMenuProps {
  currentTrack: Track;
  duration?: number;
  onOverlayChange?: (open: boolean) => void;
  onAddToCollection?: () => Promise<void>;
  className?: string;
}

export function PlayerTrackMenu({
  currentTrack,
  onOverlayChange,
  className,
}: PlayerTrackMenuProps) {
  const menuTrack = useMemo(
    () => trackToMenuData(currentTrack),
    [currentTrack],
  );
  const playlistActions = useTrackPlaylistActions();
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: currentTrack.albumCover,
    ...playlistActions,
  });
  const handleOpenChange = useCallback(
    (open: boolean) => {
      playlistActions.onOpenChange(open);
      onOverlayChange?.(open);
    },
    [onOverlayChange, playlistActions.onOpenChange],
  );
  const actionMenu = useItemActionMenu(actions, {
    onOpenChange: handleOpenChange,
  });

  return (
    <>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className={className ?? "shrink-0 size-8"}
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: currentTrack.title,
          subtitle: currentTrack.artist,
          detail: currentTrack.album,
          imageUrl: currentTrack.albumCover,
          imageAlt: currentTrack.album
            ? `${currentTrack.title} cover`
            : currentTrack.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </>
  );
}
