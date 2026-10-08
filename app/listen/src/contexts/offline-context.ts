import { createContext } from "react";

import type {
  OfflineItemRecord,
  OfflineItemState,
  OfflineSummary,
} from "@/lib/offline";

export interface OfflineTrackInput {
  entityUid?: string | null;
  trackId?: number | null;
  libraryTrackId?: number | null;
  storageId?: string | null;
  path?: string | null;
  title?: string | null;
}

export interface OfflineAlbumInput {
  albumId?: number | null;
  title?: string | null;
}

export interface OfflinePlaylistInput {
  playlistId?: number | null;
  title?: string | null;
  isSmart?: boolean;
}

export interface OfflineCrateInput {
  crateId?: string | null;
  title?: string | null;
}

export interface OfflineContextValue {
  supported: boolean;
  readOnly: boolean;
  syncing: boolean;
  items: OfflineItemRecord[];
  summary: OfflineSummary;
  getTrackState: (ref?: string | OfflineTrackInput | null) => OfflineItemState;
  getAlbumState: (albumId?: number | null) => OfflineItemState;
  getPlaylistState: (playlistId?: number | null) => OfflineItemState;
  getCrateState: (crateId?: string | null) => OfflineItemState;
  getAlbumRecord: (albumId?: number | null) => OfflineItemRecord | null;
  getPlaylistRecord: (playlistId?: number | null) => OfflineItemRecord | null;
  getCrateRecord: (crateId?: string | null) => OfflineItemRecord | null;
  isTrackOffline: (ref?: string | OfflineTrackInput | null) => boolean;
  isAlbumOffline: (albumId?: number | null) => boolean;
  isPlaylistOffline: (playlistId?: number | null) => boolean;
  isCrateOffline: (crateId?: string | null) => boolean;
  toggleTrackOffline: (
    input: OfflineTrackInput,
  ) => Promise<"enabled" | "removed">;
  toggleAlbumOffline: (
    input: OfflineAlbumInput,
  ) => Promise<"enabled" | "removed">;
  togglePlaylistOffline: (
    input: OfflinePlaylistInput,
  ) => Promise<"enabled" | "removed">;
  toggleCrateOffline: (
    input: OfflineCrateInput,
  ) => Promise<"enabled" | "removed">;
  syncAll: () => Promise<void>;
  clearActiveProfile: () => Promise<void>;
}

export const OfflineContext = createContext<OfflineContextValue | null>(null);
