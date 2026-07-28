import {
  getEffectiveAutoPlaybackPolicy,
  getPlaybackNetworkHint,
  getPlaybackQualitySignals,
  type BrowserNetworkConnection,
  type ConcretePlaybackDeliveryPolicy,
  type PlaybackSignals,
} from "./playback-network-quality";

export const PLAYER_PLAYBACK_PREFS_EVENT = "listen-player-playback-prefs";

const CROSSFADE_DURATION_KEY = "listen-player-crossfade-seconds";
const SMART_CROSSFADE_KEY = "listen-player-smart-crossfade";
const INFINITE_PLAYBACK_KEY = "listen-player-infinite-playback";
const SMART_PLAYLIST_SUGGESTIONS_KEY =
  "listen-player-smart-playlist-suggestions";
const SMART_PLAYLIST_SUGGESTIONS_CADENCE_KEY =
  "listen-player-smart-playlist-suggestions-cadence";
const PLAYBACK_DELIVERY_POLICY_KEY = "listen-player-delivery-policy";
const MOBILE_ENHANCED_AUDIO_KEY = "listen-player-mobile-enhanced-audio";

export type PlaybackDeliveryPolicy = ConcretePlaybackDeliveryPolicy;
export type PlaybackDeliveryPreference = PlaybackDeliveryPolicy | "auto";

type NavigatorConnection = BrowserNetworkConnection & {
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

const PLAYBACK_DELIVERY_POLICIES = new Set<PlaybackDeliveryPreference>([
  "auto",
  "original",
  "balanced",
  "data_saver",
]);

export function isMobilePlaybackRuntime(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || window.innerWidth < 768;
}

export function getPlaybackDeliveryNetworkHint(): PlaybackDeliveryPolicy | null {
  if (typeof navigator === "undefined") return null;
  const connection = (
    navigator as Navigator & { connection?: NavigatorConnection }
  ).connection;
  if (!connection) return null;

  const defaultPolicy = getDefaultPlaybackDeliveryPolicy();
  const effectivePolicy = getEffectiveAutoPlaybackPolicy(
    getPlaybackNetworkHint(connection),
    { consecutiveStalls: 0, stablePlaybackSeconds: 0 },
    defaultPolicy,
  );
  return effectivePolicy === defaultPolicy ? null : effectivePolicy;
}

function normalizePlaybackDeliveryPolicy(
  value: string | null | undefined,
): PlaybackDeliveryPreference | null {
  const normalized = (value || "").trim().toLowerCase().replace(/-/g, "_");
  return PLAYBACK_DELIVERY_POLICIES.has(
    normalized as PlaybackDeliveryPreference,
  )
    ? (normalized as PlaybackDeliveryPreference)
    : null;
}

export function getDefaultPlaybackDeliveryPolicy(): PlaybackDeliveryPolicy {
  return isMobilePlaybackRuntime() ? "balanced" : "original";
}

export function getPlaybackDeliveryPolicyPreference(): PlaybackDeliveryPreference {
  try {
    const explicit = normalizePlaybackDeliveryPolicy(
      localStorage.getItem(PLAYBACK_DELIVERY_POLICY_KEY),
    );
    return explicit ?? "auto";
  } catch {
    return "auto";
  }
}

export function getEffectivePlaybackDeliveryPolicy(
  preference: PlaybackDeliveryPreference = getPlaybackDeliveryPolicyPreference(),
  signals: PlaybackSignals = getPlaybackQualitySignals(),
): PlaybackDeliveryPolicy {
  if (preference !== "auto") return preference;
  const connection =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { connection?: NavigatorConnection })
          .connection;
  return getEffectiveAutoPlaybackPolicy(
    getPlaybackNetworkHint(connection),
    signals,
    getDefaultPlaybackDeliveryPolicy(),
  );
}

export function subscribeToPlaybackDeliveryNetworkChanges(
  onChange: () => void,
): () => void {
  if (typeof navigator === "undefined") return () => {};
  const connection = (
    navigator as Navigator & { connection?: NavigatorConnection }
  ).connection;
  if (!connection?.addEventListener || !connection.removeEventListener) {
    return () => {};
  }
  connection.addEventListener("change", onChange);
  return () => connection.removeEventListener?.("change", onChange);
}

export function setPlaybackDeliveryPolicyPreference(
  policy: PlaybackDeliveryPreference,
) {
  const value = normalizePlaybackDeliveryPolicy(policy) ?? "auto";
  try {
    localStorage.setItem(PLAYBACK_DELIVERY_POLICY_KEY, value);
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { playbackDeliveryPolicy: value },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getMobileEnhancedAudioPreference(): boolean {
  try {
    if (isMobilePlaybackRuntime()) {
      localStorage.removeItem(MOBILE_ENHANCED_AUDIO_KEY);
      return false;
    }
    return localStorage.getItem(MOBILE_ENHANCED_AUDIO_KEY) === "true";
  } catch {
    return false;
  }
}

export function setMobileEnhancedAudioPreference(enabled: boolean) {
  try {
    const effectiveEnabled = isMobilePlaybackRuntime() ? false : enabled;
    if (isMobilePlaybackRuntime()) {
      localStorage.removeItem(MOBILE_ENHANCED_AUDIO_KEY);
    } else {
      localStorage.setItem(
        MOBILE_ENHANCED_AUDIO_KEY,
        effectiveEnabled ? "true" : "false",
      );
    }
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { mobileEnhancedAudioEnabled: effectiveEnabled },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getCrossfadeDurationPreference(): number {
  try {
    if (isMobilePlaybackRuntime()) {
      localStorage.removeItem(CROSSFADE_DURATION_KEY);
      return 0;
    }
    const raw = localStorage.getItem(CROSSFADE_DURATION_KEY);
    if (!raw) return 0;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(parsed, 12);
  } catch {
    return 0;
  }
}

export function setCrossfadeDurationPreference(seconds: number) {
  const value = isMobilePlaybackRuntime()
    ? 0
    : Math.max(0, Math.min(seconds, 12));
  try {
    if (value === 0 && isMobilePlaybackRuntime()) {
      localStorage.removeItem(CROSSFADE_DURATION_KEY);
    } else {
      localStorage.setItem(CROSSFADE_DURATION_KEY, String(value));
    }
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { crossfadeSeconds: value },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getSmartCrossfadePreference(): boolean {
  try {
    if (isMobilePlaybackRuntime()) {
      localStorage.removeItem(SMART_CROSSFADE_KEY);
      return false;
    }
    const raw = localStorage.getItem(SMART_CROSSFADE_KEY);
    if (raw == null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

export function setSmartCrossfadePreference(enabled: boolean) {
  try {
    const effectiveEnabled = isMobilePlaybackRuntime() ? false : enabled;
    if (isMobilePlaybackRuntime()) {
      localStorage.removeItem(SMART_CROSSFADE_KEY);
    } else {
      localStorage.setItem(
        SMART_CROSSFADE_KEY,
        effectiveEnabled ? "true" : "false",
      );
    }
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { smartCrossfadeEnabled: effectiveEnabled },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getInfinitePlaybackPreference(): boolean {
  try {
    const raw = localStorage.getItem(INFINITE_PLAYBACK_KEY);
    if (raw == null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

export function setInfinitePlaybackPreference(enabled: boolean) {
  try {
    localStorage.setItem(INFINITE_PLAYBACK_KEY, enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { infinitePlaybackEnabled: enabled },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getSmartPlaylistSuggestionsPreference(): boolean {
  try {
    const raw = localStorage.getItem(SMART_PLAYLIST_SUGGESTIONS_KEY);
    if (raw == null) return false;
    return raw === "true";
  } catch {
    return false;
  }
}

export function setSmartPlaylistSuggestionsPreference(enabled: boolean) {
  try {
    localStorage.setItem(
      SMART_PLAYLIST_SUGGESTIONS_KEY,
      enabled ? "true" : "false",
    );
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { smartPlaylistSuggestionsEnabled: enabled },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getSmartPlaylistSuggestionsCadencePreference(): number {
  try {
    const raw = localStorage.getItem(SMART_PLAYLIST_SUGGESTIONS_CADENCE_KEY);
    if (!raw) return 5;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 2) return 5;
    return Math.min(parsed, 10);
  } catch {
    return 5;
  }
}

export function setSmartPlaylistSuggestionsCadencePreference(count: number) {
  const value = Math.max(2, Math.min(count, 10));
  try {
    localStorage.setItem(SMART_PLAYLIST_SUGGESTIONS_CADENCE_KEY, String(value));
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { smartPlaylistSuggestionsCadence: value },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}
