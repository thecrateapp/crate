import { SmartMixSettings } from "./SmartMixSettings";
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
import { setEqualizerEnabled } from "@/lib/equalizer-prefs";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import {
  PlaybackSettingsView,
  type PlaybackSettingsValue,
} from "./PlaybackSettingsView";
export function PlaybackSection({ ruled }: { ruled?: boolean } = {}) {
  const mobilePlaybackRuntime = isMobilePlaybackRuntime();
  const androidNativePlayerEnabled = shouldUseAndroidNativePlayer();
  const equalizerEnabled = useEqualizerEnabled(androidNativePlayerEnabled);
  const [value, setValue] = useState<
    Omit<PlaybackSettingsValue, "equalizerEnabled">
  >(() => ({
    crossfadeSeconds: getCrossfadeDurationPreference(),
    smartCrossfadeEnabled: getSmartCrossfadePreference(),
    infinitePlaybackEnabled: getInfinitePlaybackPreference(),
    smartPlaylistSuggestionsEnabled: getSmartPlaylistSuggestionsPreference(),
    smartPlaylistSuggestionsCadence:
      getSmartPlaylistSuggestionsCadencePreference(),
    playbackDeliveryPolicy: getPlaybackDeliveryPolicyPreference(),
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
    const { equalizerEnabled: eqPower, ...preferences } = patch;
    if (eqPower !== undefined) setEqualizerEnabled(eqPower);
    setValue((current) => ({ ...current, ...preferences }));
  };
  return (
    <PlaybackSettingsView
      ruled={ruled}
      smartMixSettings={<SmartMixSettings />}
      value={{ ...value, equalizerEnabled }}
      onChange={change}
      mobilePlaybackRuntime={mobilePlaybackRuntime}
      androidNativePlayerEnabled={androidNativePlayerEnabled}
    />
  );
}
