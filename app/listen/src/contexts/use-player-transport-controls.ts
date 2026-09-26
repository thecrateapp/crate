import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlayerPauseOptions } from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";
import {
  androidNativeEngine as nativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { isNative } from "@/lib/capacitor-runtime";
import {
  fadeInAndPlay as gpFadeInAndPlay,
  fadeOutAndPause as gpFadeOutAndPause,
  pause as gpPause,
  play as gpPlay,
  restoreVolume as gpRestoreVolume,
  seekTo as gpSeekTo,
  setPlaybackRate as gpSetPlaybackRate,
  setVolume as gpSetVolume,
} from "@/lib/gapless-player";
import {
  castPause,
  castPlay,
  castSeek,
  castSetVolume,
  isCastSessionActive,
} from "@/lib/cast-sender";
import { cancelPendingAudioOutputResume } from "@/lib/audio-output-interruption";
import {
  cancelNativeMediaSessionResume,
  markNativeMediaSessionPlayingIntent,
} from "@/lib/native-media-session";

const SOFT_PAUSE_FADE_MS = 220;

function shouldUseImmediateTransportAction(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export interface UsePlayerTransportControlsParams {
  queueRef: MutableRefObject<Track[]>;
  isPlayingRef: MutableRefObject<boolean>;
  bufferingIntentRef: MutableRefObject<boolean>;
  lastNonZeroVolumeRef: MutableRefObject<number>;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitCurrentTime: (time: number) => void;
  setVolumeState: Dispatch<SetStateAction<number>>;
  markSeekPosition: (seconds: number) => void;
  cancelSoftInterruption: () => void;
  silenceGaplessEngine: () => void;
}

export function usePlayerTransportControls({
  queueRef,
  isPlayingRef,
  bufferingIntentRef,
  lastNonZeroVolumeRef,
  commitIsPlaying,
  commitIsBuffering,
  commitCurrentTime,
  setVolumeState,
  markSeekPosition,
  cancelSoftInterruption,
  silenceGaplessEngine,
}: UsePlayerTransportControlsParams) {
  const pauseLocal = useCallback(() => {
    cancelPendingAudioOutputResume();
    void cancelNativeMediaSessionResume();
    cancelSoftInterruption();
    bufferingIntentRef.current = false;
    commitIsBuffering(false);
    if (shouldUseAndroidNativePlayer()) {
      silenceGaplessEngine();
      void nativeEngine.pause().catch((error) => {
        console.error("[native-player] failed to pause local playback:", error);
      });
      return;
    }
    gpPause();
  }, [
    bufferingIntentRef,
    cancelSoftInterruption,
    commitIsBuffering,
    silenceGaplessEngine,
  ]);

  const resumeLocal = useCallback(() => {
    if (!queueRef.current.length) return;
    cancelPendingAudioOutputResume();
    markNativeMediaSessionPlayingIntent();
    cancelSoftInterruption();
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
    if (shouldUseAndroidNativePlayer()) {
      silenceGaplessEngine();
      void nativeEngine.play().catch((error) => {
        console.error(
          "[native-player] failed to resume local playback:",
          error,
        );
        commitIsBuffering(false);
      });
      return;
    }
    if (shouldUseImmediateTransportAction()) {
      gpRestoreVolume();
      gpPlay();
      return;
    }
    void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
      gpRestoreVolume();
      gpPlay();
    });
  }, [
    bufferingIntentRef,
    cancelSoftInterruption,
    commitIsBuffering,
    queueRef,
    silenceGaplessEngine,
  ]);

  const pause = useCallback(
    (options?: PlayerPauseOptions) => {
      if (!options?.preserveAudioOutputResume) {
        cancelPendingAudioOutputResume();
      }
      if (!options?.preserveNativeResume) {
        void cancelNativeMediaSessionResume();
      }
      if (isCastSessionActive()) {
        void castPause()
          .then((result) => {
            if (!result.ok) {
              console.error("[cast] failed to pause:", result.message);
              return;
            }
            commitIsPlaying(false);
          })
          .catch((error) => {
            console.error("[cast] failed to pause:", error);
          });
        return;
      }
      cancelSoftInterruption();
      bufferingIntentRef.current = false;
      commitIsBuffering(false);
      if (shouldUseAndroidNativePlayer()) {
        silenceGaplessEngine();
        void nativeEngine.pause().catch((error) => {
          console.error("[native-player] failed to pause:", error);
        });
        commitIsPlaying(false);
        return;
      }
      if (options?.immediate || shouldUseImmediateTransportAction()) {
        gpPause();
        return;
      }
      void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {
        gpPause();
      });
    },
    [
      bufferingIntentRef,
      cancelSoftInterruption,
      commitIsBuffering,
      commitIsPlaying,
      silenceGaplessEngine,
    ],
  );

  const resume = useCallback(() => {
    if (!queueRef.current.length) return;
    cancelPendingAudioOutputResume();
    markNativeMediaSessionPlayingIntent();
    if (isCastSessionActive()) {
      void castPlay()
        .then((result) => {
          if (!result.ok) {
            console.error("[cast] failed to resume:", result.message);
            return;
          }
          commitIsPlaying(true);
        })
        .catch((error) => {
          console.error("[cast] failed to resume:", error);
        });
      return;
    }
    cancelSoftInterruption();
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
    if (shouldUseAndroidNativePlayer()) {
      silenceGaplessEngine();
      void nativeEngine.play().catch((error) => {
        console.error("[native-player] failed to resume:", error);
        commitIsBuffering(false);
      });
      return;
    }
    if (shouldUseImmediateTransportAction()) {
      gpRestoreVolume();
      gpPlay();
      return;
    }
    void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
      gpRestoreVolume();
      gpPlay();
    });
  }, [
    bufferingIntentRef,
    cancelSoftInterruption,
    commitIsBuffering,
    commitIsPlaying,
    queueRef,
    silenceGaplessEngine,
  ]);

  const seek = useCallback(
    (time: number) => {
      if (isCastSessionActive()) {
        void castSeek(time)
          .then((result) => {
            if (!result.ok) {
              console.error("[cast] failed to seek:", result.message);
              return;
            }
            commitCurrentTime(time);
            markSeekPosition(time);
          })
          .catch((error) => {
            console.error("[cast] failed to seek:", error);
          });
        return;
      }
      const shouldResumeBufferingFlow = isPlayingRef.current;
      bufferingIntentRef.current = shouldResumeBufferingFlow;
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.seekTo(time * 1000).catch((error) => {
          console.error("[native-player] failed to seek:", error);
        });
      } else {
        gpSeekTo(time * 1000);
      }
      commitCurrentTime(time);
      commitIsBuffering(shouldResumeBufferingFlow);
      markSeekPosition(time);
    },
    [
      bufferingIntentRef,
      commitCurrentTime,
      commitIsBuffering,
      isPlayingRef,
      markSeekPosition,
    ],
  );

  const setVolume = useCallback(
    (volume: number) => {
      if (isCastSessionActive()) {
        void castSetVolume(volume)
          .then((result) => {
            if (!result.ok) {
              console.error("[cast] failed to set volume:", result.message);
              return;
            }
            setVolumeState(volume);
            if (volume > 0) {
              lastNonZeroVolumeRef.current = volume;
            }
            try {
              localStorage.setItem("listen-player-volume", String(volume));
            } catch {
              // ignore persistence failures
            }
          })
          .catch((error) => {
            console.error("[cast] failed to set volume:", error);
          });
        return;
      }
      const effectiveVolume = isNative ? 1 : volume;
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.setVolume(effectiveVolume).catch((error) => {
          console.error("[native-player] failed to set volume:", error);
        });
      }
      gpSetVolume(effectiveVolume);
      setVolumeState(effectiveVolume);
      if (effectiveVolume > 0) {
        lastNonZeroVolumeRef.current = effectiveVolume;
      }
      if (isNative) return;
      try {
        localStorage.setItem("listen-player-volume", String(effectiveVolume));
      } catch {
        // ignore persistence failures
      }
    },
    [lastNonZeroVolumeRef, setVolumeState],
  );

  const setPlaybackRate = useCallback((rate: number) => {
    const safeRate = Math.max(0.25, Math.min(rate, 4));
    if (shouldUseAndroidNativePlayer()) {
      void nativeEngine.setPlaybackRate(safeRate).catch((error) => {
        console.error("[native-player] failed to set playback rate:", error);
      });
    } else {
      gpSetPlaybackRate(safeRate);
    }
  }, []);

  return {
    pause,
    pauseLocal,
    resume,
    resumeLocal,
    seek,
    setVolume,
    setPlaybackRate,
  };
}
