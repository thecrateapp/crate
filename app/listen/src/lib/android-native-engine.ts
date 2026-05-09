import { registerPlugin, type PermissionState, type PluginListenerHandle } from "@capacitor/core";

import { isAndroidNative } from "@/lib/capacitor-runtime";
import { getCrossfadeDurationPreference } from "@/lib/player-playback-prefs";
import type {
  EngineEventListener,
  EngineEventMap,
  EngineEventName,
  EngineQueueSnapshot,
  EngineRepeatMode,
  EngineState,
  EngineTrack,
  PlaybackEngine,
} from "@/lib/playback-engine";

const NATIVE_PLAYER_DISABLED_KEY = "crate-native-player-disabled";
const NATIVE_PLAYER_CROSSFADE_KEY = "crate-native-player-crossfade-enabled";
const NATIVE_PLAYER_EQ_KEY = "crate-native-player-eq-enabled";

type NativeEventEnvelope = {
  event?: EngineEventName;
  payload?: EngineEventMap[EngineEventName];
};

type NativePlaybackPermissionStatus = {
  notifications?: PermissionState;
};

type CrateNativePlaybackPlugin = {
  checkPermissions(): Promise<NativePlaybackPermissionStatus>;
  requestPermissions(options?: { permissions?: string[] }): Promise<NativePlaybackPermissionStatus>;
  getState(): Promise<EngineState>;
  drainEvents(): Promise<{ events?: NativeEventEnvelope[] }>;
  setQueue(options: EngineQueueSnapshot): Promise<EngineState>;
  appendTracks(options: { revision: string; tracks: EngineTrack[] }): Promise<EngineState>;
  insertTrack(options: { revision: string; index: number; track: EngineTrack }): Promise<EngineState>;
  removeTrack(options: { revision: string; index: number }): Promise<EngineState>;
  reorderTrack(options: { revision: string; fromIndex: number; toIndex: number }): Promise<EngineState>;
  play(): Promise<EngineState>;
  pause(): Promise<EngineState>;
  stop(): Promise<EngineState>;
  seekTo(options: { positionMs: number }): Promise<EngineState>;
  jumpTo(options: { index: number; autoplay: boolean }): Promise<EngineState>;
  next(): Promise<EngineState>;
  previous(): Promise<EngineState>;
  setRepeat(options: { repeat: EngineRepeatMode }): Promise<EngineState>;
  setCrossfadeMs(options: { crossfadeMs: number }): Promise<EngineState>;
  setVolume(options: { volume: number }): Promise<EngineState>;
  setPlaybackRate(options: { rate: number }): Promise<EngineState>;
  setEq(options: { enabled: boolean; gains: number[]; rampMs?: number }): Promise<EngineState>;
  addListener<K extends EngineEventName>(
    event: K,
    listener: EngineEventListener<K>,
  ): Promise<PluginListenerHandle>;
};

const nativePlayback = registerPlugin<CrateNativePlaybackPlugin>("CrateNativePlayback");

export function isAndroidNativePlayerAvailable(): boolean {
  return isAndroidNative;
}

export function shouldUseAndroidNativePlayer(): boolean {
  if (!isAndroidNativePlayerAvailable()) return false;
  try {
    if (getCrossfadeDurationPreference() > 0) return false;
    return localStorage.getItem(NATIVE_PLAYER_DISABLED_KEY) !== "true";
  } catch {
    return true;
  }
}

export function setAndroidNativePlayerEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.removeItem(NATIVE_PLAYER_DISABLED_KEY);
    } else {
      localStorage.setItem(NATIVE_PLAYER_DISABLED_KEY, "true");
    }
    window.dispatchEvent(new CustomEvent("crate:native-player-pref-changed"));
  } catch {
    // Preference changes are best-effort in constrained storage modes.
  }
}

export function isAndroidNativeCrossfadeEnabled(): boolean {
  try {
    return localStorage.getItem(NATIVE_PLAYER_CROSSFADE_KEY) === "true";
  } catch {
    return false;
  }
}

export function isAndroidNativeEqEnabled(): boolean {
  try {
    return localStorage.getItem(NATIVE_PLAYER_EQ_KEY) !== "false";
  } catch {
    return true;
  }
}

export class AndroidNativeEngine implements PlaybackEngine {
  private readyPromise: Promise<void> | null = null;
  private queueRevision = "";
  private notificationPermissionPrompted = false;

  private async ensureReady(): Promise<void> {
    try {
      await nativePlayback.getState();
      return;
    } catch {
      // The Capacitor plugin may still be binding the service after WebView load.
    }

    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve, reject) => {
        let settled = false;
        let handle: PluginListenerHandle | null = null;
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          void handle?.remove();
          this.readyPromise = null;
          reject(new Error("Native playback service did not become ready"));
        }, 3000);

        void nativePlayback.addListener("ready", () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          void handle?.remove();
          this.readyPromise = null;
          resolve();
        }).then((listenerHandle) => {
          handle = listenerHandle;
        }).catch((error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          this.readyPromise = null;
          reject(error);
        });
      });
    }

    await this.readyPromise;
  }

  private async ensureNotificationPermission(): Promise<void> {
    if (this.notificationPermissionPrompted) return;
    this.notificationPermissionPrompted = true;

    try {
      const permissions = await nativePlayback.checkPermissions();
      if (permissions.notifications === "granted") return;
      await nativePlayback.requestPermissions({ permissions: ["notifications"] });
    } catch {
      // Notification permission is best-effort; playback must keep working if declined.
    }
  }

  async loadQueue(snapshot: EngineQueueSnapshot): Promise<EngineState> {
    await this.ensureReady();
    if (snapshot.autoplay) {
      await this.ensureNotificationPermission();
    }
    this.queueRevision = snapshot.revision;
    return nativePlayback.setQueue(snapshot);
  }

  async play(): Promise<EngineState> {
    await this.ensureReady();
    await this.ensureNotificationPermission();
    return nativePlayback.play();
  }

  async pause(): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.pause();
  }

  async stop(): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.stop();
  }

  async seekTo(positionMs: number): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.seekTo({ positionMs });
  }

  async next(): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.next();
  }

  async previous(): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.previous();
  }

  async jumpTo(index: number, autoplay: boolean): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.jumpTo({ index, autoplay });
  }

  async appendTracks(tracks: EngineTrack[]): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.appendTracks({ revision: this.queueRevision, tracks });
  }

  async insertTrack(index: number, track: EngineTrack): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.insertTrack({ revision: this.queueRevision, index, track });
  }

  async removeTrack(index: number): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.removeTrack({ revision: this.queueRevision, index });
  }

  async reorderTrack(fromIndex: number, toIndex: number): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.reorderTrack({ revision: this.queueRevision, fromIndex, toIndex });
  }

  async setRepeat(repeat: EngineRepeatMode): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.setRepeat({ repeat });
  }

  async setCrossfadeMs(crossfadeMs: number): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.setCrossfadeMs({ crossfadeMs });
  }

  async setVolume(volume: number): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.setVolume({ volume });
  }

  async setPlaybackRate(rate: number): Promise<EngineState> {
    await this.ensureReady();
    return nativePlayback.setPlaybackRate({ rate });
  }

  async setEq(enabled: boolean, gains: number[], rampMs?: number): Promise<EngineState> {
    await this.ensureReady();
    if (!isAndroidNativeEqEnabled()) {
      return nativePlayback.setEq({ enabled: false, gains: [], rampMs: 0 });
    }
    return nativePlayback.setEq({ enabled, gains, rampMs });
  }

  async getState(): Promise<EngineState | null> {
    try {
      const state = await nativePlayback.getState();
      if (state.revision) this.queueRevision = state.revision;
      return state;
    } catch {
      return null;
    }
  }

  async drainEvents(): Promise<Array<{ event: EngineEventName; payload: EngineEventMap[EngineEventName] }>> {
    const response = await nativePlayback.drainEvents();
    return (response.events ?? []).flatMap((event) => {
      if (!event.event || !event.payload) return [];
      return [{ event: event.event, payload: event.payload }];
    });
  }

  async on<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): Promise<() => void> {
    const handle = await nativePlayback.addListener(event, listener);
    return () => {
      void handle.remove();
    };
  }

  async destroy(): Promise<void> {
    await this.ensureReady();
    await nativePlayback.stop();
  }
}

export const androidNativeEngine = new AndroidNativeEngine();
