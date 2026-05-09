import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { GaplessWebEngine } from "@/lib/gapless-web-engine";
import type { PlaybackEngine } from "@/lib/playback-engine";

export function createPlaybackEngine(): PlaybackEngine {
  return shouldUseAndroidNativePlayer()
    ? androidNativeEngine
    : new GaplessWebEngine();
}
