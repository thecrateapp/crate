import type { AlbumData } from "@/pages/album-types";
import type { OfflineItemState } from "@/lib/offline";

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
  playerTracksAvailable: boolean;
}

export interface AlbumActionHandlers {
  onAlbumRadio: () => void;
  onToggleOffline: () => void;
  onToggleSaved: () => void;
  onShare: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onMenuClose: () => void;
}

export interface AlbumActionData {
  data: AlbumData;
  coverUrl: string;
  displayName: string;
  globalAlbumUid: string | null;
}
