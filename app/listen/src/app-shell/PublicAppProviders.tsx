import type { ReactNode } from "react";

import {
  OfflineContext,
  type OfflineContextValue,
} from "@/contexts/offline-context";
import {
  PlayerActionsContext,
  PlayerProgressContext,
  PlayerStateContext,
  type PlayerActionsValue,
  type PlayerProgressValue,
  type PlayerStateValue,
} from "@/contexts/player-context";

const noop = () => undefined;
const unavailable = async (): Promise<never> => {
  throw new Error("Unavailable without a Crate session");
};

const publicOfflineValue: OfflineContextValue = {
  supported: false,
  syncing: false,
  summary: {
    itemCount: 0,
    readyItemCount: 0,
    errorItemCount: 0,
    trackCount: 0,
    readyTrackCount: 0,
    totalBytes: 0,
  },
  getTrackState: () => "idle",
  getAlbumState: () => "idle",
  getPlaylistState: () => "idle",
  getCrateState: () => "idle",
  getAlbumRecord: () => null,
  getPlaylistRecord: () => null,
  getCrateRecord: () => null,
  isTrackOffline: () => false,
  isAlbumOffline: () => false,
  isPlaylistOffline: () => false,
  isCrateOffline: () => false,
  toggleTrackOffline: unavailable,
  toggleAlbumOffline: unavailable,
  togglePlaylistOffline: unavailable,
  toggleCrateOffline: unavailable,
  syncAll: async () => undefined,
  clearActiveProfile: async () => undefined,
};

const publicPlayerState: PlayerStateValue = {
  isPlaying: false,
  isBuffering: false,
  volume: 1,
  analyserVersion: 0,
  crossfadeTransition: null,
};

const publicPlayerProgress: PlayerProgressValue = {
  currentTime: 0,
  duration: 0,
};

const publicPlayerActions: PlayerActionsValue = {
  queue: [],
  currentIndex: 0,
  jamQueueLocked: false,
  jamTransport: null,
  shuffle: false,
  repeat: "off",
  smartCrossfadeEnabled: false,
  playSource: null,
  recentlyPlayed: [],
  currentTrack: undefined,
  play: noop,
  playAll: noop,
  pause: noop,
  pauseLocal: noop,
  resume: noop,
  resumeLocal: noop,
  next: noop,
  prev: noop,
  seek: noop,
  setVolume: noop,
  setPlaybackRate: noop,
  clearQueue: noop,
  toggleShuffle: noop,
  cycleRepeat: noop,
  setRepeatMode: noop,
  jumpTo: noop,
  playNext: noop,
  addToQueue: noop,
  removeFromQueue: noop,
  reorderQueue: noop,
  enterJamSession: noop,
  leaveJamSession: noop,
  setJamTransport: noop,
  syncJamQueue: noop,
  captureQueueSnapshot: () => ({
    queue: [],
    currentIndex: 0,
    currentTime: 0,
    isPlaying: false,
    shuffle: false,
    repeat: "off",
    playSource: null,
    unshuffledQueue: null,
  }),
  restoreQueueSnapshot: noop,
  publishConnectState: async () => undefined,
  connect: {
    activeInstanceId: null,
    connectedInstances: [],
    enabled: false,
    isRemoteActive: false,
    playbackInstanceId: null,
    remoteState: null,
    requestTransfer: () => false,
    sendRemoteCommand: () => false,
    serverClockOffsetMs: 0,
    transport: null,
  },
};

export function PublicAppProviders({ children }: { children: ReactNode }) {
  return (
    <PlayerStateContext.Provider value={publicPlayerState}>
      <PlayerProgressContext.Provider value={publicPlayerProgress}>
        <PlayerActionsContext.Provider value={publicPlayerActions}>
          <OfflineContext.Provider value={publicOfflineValue}>
            {children}
          </OfflineContext.Provider>
        </PlayerActionsContext.Provider>
      </PlayerProgressContext.Provider>
    </PlayerStateContext.Provider>
  );
}
