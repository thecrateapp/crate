import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SleepTimerView } from "./SleepTimerView";

import { Section } from "@/components/settings/SettingsPrimitives";
import { usePlayerActions } from "@/contexts/PlayerContext";
import {
  cancelSleepTimer,
  formatRemaining,
  startSleepTimer,
  subscribeSleepTimer,
  type SleepTimerMode,
  type SleepTimerState,
} from "@/lib/sleep-timer";

const SLEEP_MODES: { mode: SleepTimerMode; labelKey: string }[] = [
  { mode: "15min", labelKey: "settings.sleep.modes.15min" },
  { mode: "30min", labelKey: "settings.sleep.modes.30min" },
  { mode: "45min", labelKey: "settings.sleep.modes.45min" },
  { mode: "1hr", labelKey: "settings.sleep.modes.1hr" },
  { mode: "end_of_track", labelKey: "settings.sleep.modes.endOfTrack" },
];

export function SleepTimerSection() {
  const { t } = useTranslation();
  const { pause } = usePlayerActions();
  const [timer, setTimer] = useState<SleepTimerState>({
    active: false,
    remainingSeconds: 0,
    mode: null,
  });
  useEffect(() => subscribeSleepTimer(setTimer), []);

  return (
    <Section
      title={t("settings.sleep.title")}
      description={t("settings.sleep.subtitle")}
    >
      <SleepTimerView
        label={t("settings.sleep.title")}
        value={timer.mode ?? ""}
        options={SLEEP_MODES.map((item) => ({
          value: item.mode,
          label: t(item.labelKey),
        }))}
        onChange={(value) => startSleepTimer(value as SleepTimerMode, pause)}
        active={timer.active}
        remaining={
          timer.active && timer.remainingSeconds > 0
            ? `${t("settings.sleep.pausingIn")} ${formatRemaining(timer.remainingSeconds)}`
            : undefined
        }
        cancelLabel={t("common.cancel")}
        onCancel={cancelSleepTimer}
      />
    </Section>
  );
}
