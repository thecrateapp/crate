import { useMemo } from "react";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { TrackActionMenuHeader } from "@/components/actions/TrackActionMenuHeader";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
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
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: currentTrack.albumCover,
  });
  const actionMenu = useItemActionMenu(actions, {
    onOpenChange: onOverlayChange,
  });

  return (
    <>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className={className ?? "shrink-0 h-8 w-8"}
      />
      <ItemActionMenu
        actions={actions}
        header={
          <TrackActionMenuHeader
            coverUrl={currentTrack.albumCover}
            title={currentTrack.title}
            artist={currentTrack.artist}
            album={currentTrack.album}
          />
        }
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </>
  );
}
