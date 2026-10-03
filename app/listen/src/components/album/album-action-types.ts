import type { RefObject, MouseEvent } from "react";

import type { ContextMenuEntry } from "@/components/actions/ItemActionMenu";
import type { AlbumData } from "@/pages/album-types";
import type { OfflineItemState } from "@/lib/offline";
import type { UseContextMenuControllerReturn } from "@crate/ui/domain/actions";

export const SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

export const PRIMARY_ACTIONS_GROUP_CLASS =
  "grid grid-cols-2 gap-3 md:flex md:shrink-0 md:items-center md:gap-3";

export const PRIMARY_PLAY_ACTION_CLASS =
  "flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-accent-action px-5 text-sm font-semibold text-accent-action-foreground shadow-action-solid transition-[background-color,box-shadow] hover:bg-accent-action/90 hover:shadow-action-solid-hover disabled:cursor-not-allowed disabled:opacity-45 md:px-7 md:text-[0.9375rem]";

export const PRIMARY_SHUFFLE_ACTION_CLASS =
  "flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-text-primary/[0.08] px-5 text-sm font-semibold text-text-primary shadow-control-inset transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-text-primary/[0.12] hover:text-accent-action hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:opacity-45 md:w-auto md:px-7";

export interface AlbumActionState {
  isPreRelease: boolean;
  canPersistAlbum: boolean;
  canSaveAlbum: boolean;
  offlineSupported: boolean;
  offlineState: OfflineItemState;
  offlineBusy: boolean;
  offlineButtonLabel: string;
  offlineStatusDetail: string | null;
  saved: boolean;
  remoteOnly: boolean;
  isDesktop: boolean;
  playerTracksAvailable: boolean;
}

export interface AlbumActionHandlers {
  onAlbumRadio: () => void;
  onToggleOffline: () => void;
  onToggleSaved: () => void;
  onShare: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onCloseAlbumMenu: () => void;
  onToggleAlbumMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}

export interface AlbumActionMenu {
  controller: UseContextMenuControllerReturn<HTMLButtonElement>;
  items: ContextMenuEntry[];
  primaryRef: RefObject<HTMLDivElement | null>;
}

export interface AlbumActionData {
  data: AlbumData;
  coverUrl: string;
  displayName: string;
  globalAlbumUid: string | null;
}
