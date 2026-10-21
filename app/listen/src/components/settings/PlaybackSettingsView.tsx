import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RangeRow, Section, SelectRow, ToggleRow } from "./SettingsPrimitives";
export interface PlaybackSettingsValue {
  crossfadeSeconds: number;
  smartCrossfadeEnabled: boolean;
  infinitePlaybackEnabled: boolean;
  smartPlaylistSuggestionsEnabled: boolean;
  smartPlaylistSuggestionsCadence: number;
  playbackDeliveryPolicy: "auto" | "balanced" | "original" | "data_saver";
  equalizerEnabled: boolean;
}
const PLAYBACK_DELIVERY_OPTIONS: {
  value: PlaybackSettingsValue["playbackDeliveryPolicy"];
  labelKey: string;
  descriptionKey: string;
}[] = [
  {
    value: "auto",
    labelKey: "settings.playback.delivery.auto",
    descriptionKey: "settings.playback.delivery.autoDescription",
  },
  {
    value: "balanced",
    labelKey: "settings.playback.delivery.balanced",
    descriptionKey: "settings.playback.delivery.balancedDescription",
  },
  {
    value: "original",
    labelKey: "settings.playback.delivery.original",
    descriptionKey: "settings.playback.delivery.originalDescription",
  },
  {
    value: "data_saver",
    labelKey: "settings.playback.delivery.dataSaver",
    descriptionKey: "settings.playback.delivery.dataSaverDescription",
  },
];

export function PlaybackSettingsView({
  ruled,
  value,
  mobilePlaybackRuntime,
  androidNativePlayerEnabled,
  onChange,
  smartMixSettings,
}: {
  smartMixSettings?: ReactNode;
  ruled?: boolean;
  value: PlaybackSettingsValue;
  mobilePlaybackRuntime: boolean;
  androidNativePlayerEnabled: boolean;
  onChange: (patch: Partial<PlaybackSettingsValue>) => void;
}) {
  const { t } = useTranslation();
  const {
    crossfadeSeconds,
    smartCrossfadeEnabled,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    playbackDeliveryPolicy,
    equalizerEnabled,
  } = value;
  return (
    <Section
      ruled={ruled}
      title={t("settings.playback.title")}
      description={t("settings.playback.subtitle")}
    >
      <SelectRow
        label={t("settings.playback.streamQuality")}
        description={t("settings.playback.streamQualityDescription")}
        value={playbackDeliveryPolicy}
        onChange={(value) => onChange({ playbackDeliveryPolicy: value })}
        options={PLAYBACK_DELIVERY_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
          description: t(option.descriptionKey),
        }))}
      />
      <ToggleRow
        label={t("settings.playback.infinitePlayback")}
        description={t("settings.playback.infinitePlaybackDescription")}
        checked={infinitePlaybackEnabled}
        onChange={(value) => onChange({ infinitePlaybackEnabled: value })}
      />
      {!mobilePlaybackRuntime ? (
        <>
          <ToggleRow
            label={t("settings.playback.smartTransitions")}
            description={t("settings.playback.smartTransitionsDescription")}
            checked={smartCrossfadeEnabled}
            onChange={(value) => onChange({ smartCrossfadeEnabled: value })}
          />
          <RangeRow
            label={t("settings.playback.crossfade")}
            description={t("settings.playback.crossfadeDescription")}
            value={crossfadeSeconds}
            min={0}
            max={12}
            step={1}
            displayValue={
              crossfadeSeconds === 0
                ? t("common.off")
                : t("common.secondsShort", { count: crossfadeSeconds })
            }
            onChange={(value) => onChange({ crossfadeSeconds: value })}
          />
        </>
      ) : null}
      {smartMixSettings}
      {!mobilePlaybackRuntime || androidNativePlayerEnabled ? (
        <ToggleRow
          label={t("player.equalizer")}
          checked={equalizerEnabled}
          onChange={(value) => onChange({ equalizerEnabled: value })}
        />
      ) : null}
      <ToggleRow
        label={t("settings.playback.smartPlaylistSuggestions")}
        description={t("settings.playback.smartPlaylistSuggestionsDescription")}
        checked={smartPlaylistSuggestionsEnabled}
        onChange={(value) =>
          onChange({ smartPlaylistSuggestionsEnabled: value })
        }
      />
      <RangeRow
        label={t("settings.playback.suggestionCadence")}
        description={t("settings.playback.suggestionCadenceDescription")}
        value={smartPlaylistSuggestionsCadence}
        min={2}
        max={10}
        step={1}
        displayValue={t("settings.playback.suggestionCadenceValue", {
          count: smartPlaylistSuggestionsCadence,
        })}
        disabled={!smartPlaylistSuggestionsEnabled}
        onChange={(value) =>
          onChange({ smartPlaylistSuggestionsCadence: value })
        }
      />
    </Section>
  );
}
