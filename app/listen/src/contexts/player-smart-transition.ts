import type { PlaySource, Track } from "@/contexts/player-types";
import {
  isMobileAudioRuntime,
  stableMobileAudioPipeline,
} from "@/lib/mobile-audio-mode";
import {
  legacySmartTransitionSeconds,
  SMART_TRANSITION_BALANCED_SECONDS,
  SMART_TRANSITION_LONG_SECONDS,
  SMART_TRANSITION_MIXED_QUEUE_SECONDS,
  SMART_TRANSITION_SHORT_SECONDS,
} from "@/lib/smart-mix";

export const ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS = 1;
export const ANDROID_MEDIA_SESSION_HANDOFF_SECONDS = 0.15;
export {
  SMART_TRANSITION_BALANCED_SECONDS,
  SMART_TRANSITION_LONG_SECONDS,
  SMART_TRANSITION_MIXED_QUEUE_SECONDS,
  SMART_TRANSITION_SHORT_SECONDS,
};

export function areTracksFromSameAlbum(
  currentTrack: Track | undefined,
  nextTrack: Track | null | undefined,
): boolean {
  if (!currentTrack || !nextTrack) return false;
  return (
    !!currentTrack.album &&
    !!nextTrack.album &&
    !!currentTrack.artist &&
    !!nextTrack.artist &&
    currentTrack.album === nextTrack.album &&
    currentTrack.artist === nextTrack.artist
  );
}

export function isContinuousAlbumTransition(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
): boolean {
  if (!currentTrack || !nextTrack) return false;
  if (shuffle) return false;
  if (playSource?.type !== "album") return false;
  return areTracksFromSameAlbum(currentTrack, nextTrack);
}

export function getEffectiveCrossfadeSeconds(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
  configuredSeconds: number,
  smartCrossfadeEnabled: boolean,
  options: {
    androidNative?: boolean;
    html5OnlyPlayback?: boolean;
    mobileEnhancedAudio?: boolean;
  } = {},
): number {
  if (
    isMobileAudioRuntime ||
    options.androidNative ||
    options.html5OnlyPlayback
  ) {
    return 0;
  }
  const clampedSeconds = Math.max(0, configuredSeconds || 0);
  const continuousAlbumTransition = isContinuousAlbumTransition(
    currentTrack,
    nextTrack,
    playSource,
    shuffle,
  );
  const mobileHtml5Pipeline =
    (options.androidNative || stableMobileAudioPipeline) &&
    !options.mobileEnhancedAudio;
  const shouldMaskHtml5Gap = options.html5OnlyPlayback ?? mobileHtml5Pipeline;

  if (smartCrossfadeEnabled && continuousAlbumTransition) {
    if (shouldMaskHtml5Gap) {
      return Math.min(
        clampedSeconds > 0
          ? clampedSeconds
          : ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS,
        ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS,
      );
    }
  }
  if (clampedSeconds <= 0) {
    if (shouldMaskHtml5Gap && nextTrack) {
      return continuousAlbumTransition
        ? ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS
        : ANDROID_MEDIA_SESSION_HANDOFF_SECONDS;
    }
    return 0;
  }
  if (!smartCrossfadeEnabled) return clampedSeconds;
  if (continuousAlbumTransition) {
    return shouldMaskHtml5Gap
      ? Math.min(clampedSeconds, ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS)
      : 0;
  }
  return Math.min(
    clampedSeconds,
    legacySmartTransitionSeconds(currentTrack, nextTrack, playSource, shuffle),
  );
}
