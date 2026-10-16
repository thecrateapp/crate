import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { RangeRow, ToggleRow } from "@/components/settings/SettingsPrimitives";
import {
  getNativeSmartMixEnabledPreference,
  getNativeSmartMixSecondsPreference,
  isNativeMixRuntime,
  setNativeSmartMixEnabledPreference,
  setNativeSmartMixSecondsPreference,
} from "@/lib/player-playback-prefs";
import {
  getServerSmartMixCapabilities,
  subscribeSmartMixCapabilities,
} from "@/lib/smart-mix";

function serverEnablesNativeMix(): boolean {
  const capabilities = getServerSmartMixCapabilities();
  return capabilities.available && capabilities.androidNativeCrossfade;
}

export function SmartMixSettings() {
  const { t } = useTranslation();
  const [nativeRuntime] = useState(isNativeMixRuntime);
  const [serverEnabled, setServerEnabled] = useState(serverEnablesNativeMix);
  const [enabled, setEnabled] = useState(getNativeSmartMixEnabledPreference);
  const [seconds, setSeconds] = useState(getNativeSmartMixSecondsPreference);

  useEffect(
    () =>
      subscribeSmartMixCapabilities(() =>
        setServerEnabled(serverEnablesNativeMix()),
      ),
    [],
  );

  if (!nativeRuntime) return null;

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
    </>
  );
}
