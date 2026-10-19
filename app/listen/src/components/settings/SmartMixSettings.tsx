import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { RangeRow, ToggleRow } from "@/components/settings/SettingsPrimitives";
import {
  getNativeBassHandoffPreference,
  getNativeBeatmatchPreference,
  getNativeSmartMixEnabledPreference,
  getNativeSmartMixSecondsPreference,
  isNativeMixRuntime,
  setNativeBassHandoffPreference,
  setNativeBeatmatchPreference,
  setNativeSmartMixEnabledPreference,
  setNativeSmartMixSecondsPreference,
} from "@/lib/player-playback-prefs";
import {
  getServerSmartMixCapabilities,
  subscribeSmartMixCapabilities,
} from "@/lib/smart-mix";

export function SmartMixSettings() {
  const { t } = useTranslation();
  const [nativeRuntime] = useState(isNativeMixRuntime);
  const [capabilities, setCapabilities] = useState(
    getServerSmartMixCapabilities,
  );
  const [beatmatch, setBeatmatch] = useState(getNativeBeatmatchPreference);
  const [bassHandoff, setBassHandoff] = useState(
    getNativeBassHandoffPreference,
  );
  const [enabled, setEnabled] = useState(getNativeSmartMixEnabledPreference);
  const [seconds, setSeconds] = useState(getNativeSmartMixSecondsPreference);

  useEffect(
    () =>
      subscribeSmartMixCapabilities(() =>
        setCapabilities(getServerSmartMixCapabilities()),
      ),
    [],
  );

  if (!nativeRuntime) return null;

  const serverEnabled =
    capabilities.available && capabilities.androidNativeCrossfade;

  if (!serverEnabled) {
    return (
      <div>
        <div className="text-sm font-medium text-text-primary">
          {t("settings.playback.smartMix")}
        </div>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          {t("settings.playback.smartMixUnavailable")}
        </p>
      </div>
    );
  }

  return (
    <>
      <ToggleRow
        label={t("settings.playback.smartMix")}
        description={t("settings.playback.smartMixDescription")}
        checked={enabled}
        onChange={(value) => {
          setEnabled(value);
          setNativeSmartMixEnabledPreference(value);
        }}
      />
      <RangeRow
        label={t("settings.playback.smartMixDuration")}
        description={t("settings.playback.smartMixDurationDescription")}
        value={seconds}
        min={0}
        max={12}
        step={1}
        disabled={!enabled}
        displayValue={
          seconds === 0
            ? t("common.off")
            : t("common.secondsShort", { count: seconds })
        }
        onChange={(value) => {
          setSeconds(value);
          setNativeSmartMixSecondsPreference(value);
        }}
      />
      {capabilities.androidBeatmatch ? (
        <ToggleRow
          label={t("settings.playback.smartMixBeatmatch")}
          description={t("settings.playback.smartMixBeatmatchDescription")}
          checked={beatmatch}
          disabled={!enabled}
          onChange={(value) => {
            setBeatmatch(value);
            setNativeBeatmatchPreference(value);
          }}
        />
      ) : null}
      {capabilities.androidBeatmatch && capabilities.androidBassHandoff ? (
        <ToggleRow
          label={t("settings.playback.smartMixBassHandoff")}
          description={t("settings.playback.smartMixBassHandoffDescription")}
          checked={bassHandoff}
          disabled={!enabled || !beatmatch}
          onChange={(value) => {
            setBassHandoff(value);
            setNativeBassHandoffPreference(value);
          }}
        />
      ) : null}
    </>
  );
}
