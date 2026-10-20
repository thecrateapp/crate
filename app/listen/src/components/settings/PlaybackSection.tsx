import { useState } from "react";

import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  isMobilePlaybackRuntime,
  getPlaybackDeliveryPolicyPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  setPlaybackDeliveryPolicyPreference,
  setInfinitePlaybackPreference,
  setCrossfadeDurationPreference,
  setSmartCrossfadePreference,
  setSmartPlaylistSuggestionsCadencePreference,
  setSmartPlaylistSuggestionsPreference,
} from "@/lib/player-playback-prefs";
import {
  getEqualizerEnabled,
  setEqualizerEnabled,
} from "@/lib/equalizer-prefs";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import {
  PlaybackSettingsView,
  type PlaybackSettingsValue,
} from "./PlaybackSettingsView";
export function PlaybackSection() {
  const mobilePlaybackRuntime = isMobilePlaybackRuntime();
  const androidNativePlayerEnabled = shouldUseAndroidNativePlayer();
  const [value, setValue] = useState<PlaybackSettingsValue>(() => ({
    crossfadeSeconds: getCrossfadeDurationPreference(),
    smartCrossfadeEnabled: getSmartCrossfadePreference(),
    infinitePlaybackEnabled: getInfinitePlaybackPreference(),
    smartPlaylistSuggestionsEnabled: getSmartPlaylistSuggestionsPreference(),
    smartPlaylistSuggestionsCadence:
      getSmartPlaylistSuggestionsCadencePreference(),
    playbackDeliveryPolicy: getPlaybackDeliveryPolicyPreference(),
    equalizerEnabled: getEqualizerEnabled(androidNativePlayerEnabled),
  }));
  const change = (patch: Partial<PlaybackSettingsValue>) => {
    if (patch.crossfadeSeconds !== undefined)
      setCrossfadeDurationPreference(patch.crossfadeSeconds);
    if (patch.smartCrossfadeEnabled !== undefined)
      setSmartCrossfadePreference(patch.smartCrossfadeEnabled);
    if (patch.infinitePlaybackEnabled !== undefined)
      setInfinitePlaybackPreference(patch.infinitePlaybackEnabled);
    if (patch.smartPlaylistSuggestionsEnabled !== undefined)
      setSmartPlaylistSuggestionsPreference(
        patch.smartPlaylistSuggestionsEnabled,
      );
    if (patch.smartPlaylistSuggestionsCadence !== undefined)
      setSmartPlaylistSuggestionsCadencePreference(
        patch.smartPlaylistSuggestionsCadence,
      );
    if (patch.playbackDeliveryPolicy !== undefined)
      setPlaybackDeliveryPolicyPreference(patch.playbackDeliveryPolicy);
    if (patch.equalizerEnabled !== undefined)
      setEqualizerEnabled(patch.equalizerEnabled);
    setValue((current) => ({ ...current, ...patch }));
  };
  return (
    <PlaybackSettingsView
      value={value}
      onChange={change}
      mobilePlaybackRuntime={mobilePlaybackRuntime}
      androidNativePlayerEnabled={androidNativePlayerEnabled}
    />
  );
}
