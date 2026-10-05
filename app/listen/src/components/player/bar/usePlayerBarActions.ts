import { useCallback } from "react";
import type { Track } from "@/contexts/player-types";
import {
  preloadEqualizerPopover,
  preloadExtendedPlayer,
  preloadFullscreenPlayer,
  preloadLyricsPanel,
  preloadQueuePanel,
} from "@/components/player/lazy-player-surfaces";
import { triggerHaptic } from "@/lib/haptics";

type UsePlayerBarActionsOptions = {
  displayTrack: Track | undefined;
  isRemoteConnectActive: boolean;
  jamQueueLocked: boolean;
  showQueue: boolean;
  showLyrics: boolean;
  extendedOpen: boolean;
  setShowQueue: (open: boolean) => void;
  setShowLyrics: (open: boolean) => void;
  setShowEqualizer: (open: boolean | ((open: boolean) => boolean)) => void;
  setExtendedOpen: (open: boolean) => void;
  setShouldRenderQueuePanel: (render: boolean) => void;
  setShouldRenderLyricsPanel: (render: boolean) => void;
  setShouldRenderEqualizerPopover: (render: boolean) => void;
  setShouldRenderExtendedPlayer: (render: boolean) => void;
  setShouldRenderFullscreenPlayer: (render: boolean) => void;
  setFsOpen: (open: boolean) => void;
  likeTrack: (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
    globalTrackUid?: string | null,
  ) => Promise<boolean>;
  unlikeTrack: (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
    globalTrackUid?: string | null,
  ) => Promise<boolean>;
  liked: boolean;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
};

export function usePlayerBarActions({
  displayTrack,
  isRemoteConnectActive,
  jamQueueLocked,
  showQueue,
  showLyrics,
  extendedOpen,
  setShowQueue,
  setShowLyrics,
  setShowEqualizer,
  setExtendedOpen,
  setShouldRenderQueuePanel,
  setShouldRenderLyricsPanel,
  setShouldRenderEqualizerPopover,
  setShouldRenderExtendedPlayer,
  setShouldRenderFullscreenPlayer,
  setFsOpen,
  likeTrack,
  unlikeTrack,
  liked,
  toggleShuffle,
  cycleRepeat,
}: UsePlayerBarActionsOptions) {
  const prepareQueuePanel = useCallback(() => {
    setShouldRenderQueuePanel(true);
    void preloadQueuePanel();
  }, [setShouldRenderQueuePanel]);

  const prepareLyricsPanel = useCallback(() => {
    if (isRemoteConnectActive) return;
    setShouldRenderLyricsPanel(true);
    void preloadLyricsPanel();
  }, [isRemoteConnectActive, setShouldRenderLyricsPanel]);

  const prepareEqualizerPopover = useCallback(() => {
    if (isRemoteConnectActive) return;
    setShouldRenderEqualizerPopover(true);
    void preloadEqualizerPopover();
  }, [isRemoteConnectActive, setShouldRenderEqualizerPopover]);

  const prepareExtendedPlayer = useCallback(() => {
    if (isRemoteConnectActive) return;
    setShouldRenderExtendedPlayer(true);
    void preloadExtendedPlayer();
  }, [isRemoteConnectActive, setShouldRenderExtendedPlayer]);

  const prepareFullscreenPlayer = useCallback(() => {
    if (isRemoteConnectActive) return;
    void preloadFullscreenPlayer();
  }, [isRemoteConnectActive]);

  const openFullscreenPlayer = useCallback(() => {
    if (isRemoteConnectActive) return;
    triggerHaptic("medium");
    setShouldRenderFullscreenPlayer(true);
    void preloadFullscreenPlayer();
    setFsOpen(true);
  }, [isRemoteConnectActive, setFsOpen, setShouldRenderFullscreenPlayer]);

  const handleToggleShuffle = useCallback(() => {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    toggleShuffle();
  }, [jamQueueLocked, toggleShuffle]);

  const handleCycleRepeat = useCallback(() => {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    cycleRepeat();
  }, [cycleRepeat, jamQueueLocked]);

  const handleToggleQueue = useCallback(() => {
    triggerHaptic("selection");
    prepareQueuePanel();
    setShowQueue(!showQueue);
    setShowLyrics(false);
  }, [prepareQueuePanel, setShowLyrics, setShowQueue, showQueue]);

  const handleToggleLyrics = useCallback(() => {
    if (isRemoteConnectActive) return;
    triggerHaptic("selection");
    prepareLyricsPanel();
    setShowLyrics(!showLyrics);
    setShowQueue(false);
  }, [
    isRemoteConnectActive,
    prepareLyricsPanel,
    setShowLyrics,
    setShowQueue,
    showLyrics,
  ]);

  const handleToggleEqualizer = useCallback(() => {
    triggerHaptic("selection");
    prepareEqualizerPopover();
    setShowEqualizer((value) => !value);
    setShowQueue(false);
    setShowLyrics(false);
  }, [prepareEqualizerPopover, setShowEqualizer, setShowLyrics, setShowQueue]);

  const handleToggleExtendedPlayer = useCallback(() => {
    if (isRemoteConnectActive) return;
    triggerHaptic("medium");
    prepareExtendedPlayer();
    setExtendedOpen(!extendedOpen);
    if (!extendedOpen) {
      setShowQueue(false);
      setShowLyrics(false);
    }
  }, [
    extendedOpen,
    isRemoteConnectActive,
    prepareExtendedPlayer,
    setExtendedOpen,
    setShowLyrics,
    setShowQueue,
  ]);

  const toggleLike = useCallback(async (): Promise<boolean | null> => {
    if (!displayTrack) return null;
    const trackId = displayTrack.libraryTrackId ?? null;
    const trackEntityUid = displayTrack.entityUid ?? null;
    const trackPath = displayTrack.path || displayTrack.id;
    try {
      if (liked) {
        await unlikeTrack(
          trackId,
          trackEntityUid,
          trackPath,
          displayTrack.globalTrackUid ?? null,
        );
        return false;
      }
      await likeTrack(
        trackId,
        trackEntityUid,
        trackPath,
        displayTrack.globalTrackUid ?? null,
      );
      return true;
    } catch {
      return null;
    }
  }, [displayTrack, likeTrack, liked, unlikeTrack]);

  return {
    handleCycleRepeat,
    handleToggleEqualizer,
    handleToggleExtendedPlayer,
    handleToggleLyrics,
    handleToggleQueue,
    handleToggleShuffle,
    openFullscreenPlayer,
    prepareEqualizerPopover,
    prepareExtendedPlayer,
    prepareFullscreenPlayer,
    prepareLyricsPanel,
    prepareQueuePanel,
    toggleLike,
  };
}
