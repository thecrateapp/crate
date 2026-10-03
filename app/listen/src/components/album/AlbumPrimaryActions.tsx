import type { RefObject } from "react";
import { Play, Shuffle } from "@crate/ui/icons";

import {
  PRIMARY_ACTIONS_GROUP_CLASS,
  PRIMARY_PLAY_ACTION_CLASS,
  PRIMARY_SHUFFLE_ACTION_CLASS,
} from "@/components/album/album-action-types";

export function AlbumPrimaryActions({
  groupLabel,
  playerTracksAvailable,
  primaryRef,
  onPlay,
  onShuffle,
  t,
}: {
  groupLabel?: string;
  playerTracksAvailable: boolean;
  primaryRef: RefObject<HTMLDivElement | null>;
  onPlay: () => void;
  onShuffle: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div
      data-testid="album-primary-actions"
      ref={primaryRef}
      role="group"
      aria-label={groupLabel ?? t("album.actions.primaryGroup")}
      className={PRIMARY_ACTIONS_GROUP_CLASS}
    >
      <button
        type="button"
        className={PRIMARY_PLAY_ACTION_CLASS}
        onClick={() => onPlay()}
        disabled={!playerTracksAvailable}
        aria-label={t("player.play")}
      >
        <Play size={17} fill="currentColor" />
        <span>{t("player.play")}</span>
      </button>
      <button
        type="button"
        className={PRIMARY_SHUFFLE_ACTION_CLASS}
        onClick={onShuffle}
        disabled={!playerTracksAvailable}
        aria-label={t("player.shuffle")}
      >
        <Shuffle size={17} />
        <span>{t("player.shuffle")}</span>
      </button>
    </div>
  );
}
