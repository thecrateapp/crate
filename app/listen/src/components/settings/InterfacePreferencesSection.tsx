import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  getUiPreferences,
  setUiPreferences,
  subscribeUiPreferences,
} from "@crate/ui/lib/interface-preferences";
import { InterfacePreferencesControls } from "./InterfacePreferencesControls";
export { InterfacePreferencesControls } from "./InterfacePreferencesControls";
export function InterfacePreferencesSection({
  ruled,
}: { ruled?: boolean } = {}) {
  const { t } = useTranslation();
  const preferences = useSyncExternalStore(
    subscribeUiPreferences,
    getUiPreferences,
    getUiPreferences,
  );
  const [saveError, setSaveError] = useState(false);

  return (
    <div>
      <InterfacePreferencesControls
        ruled={ruled}
        preferences={preferences}
        onChange={(patch) => setSaveError(!setUiPreferences(patch))}
        labels={{
          title: t("settings.interface.title"),
          description: t("settings.interface.description"),
          motionLabel: t("settings.interface.motionLabel"),
          effectsLabel: t("settings.interface.effectsLabel"),
          densityLabel: t("settings.interface.densityLabel"),
          values: Object.fromEntries(
            [
              "system",
              "reduced",
              "off",
              "subtle",
              "expressive",
              "comfortable",
              "compact",
            ].map((value) => [value, t(`settings.interface.values.${value}`)]),
          ),
        }}
      />
      {saveError ? (
        <p role="alert" className="mt-4 text-sm text-state-warning-text">
          {t("settings.interface.saveError")}
        </p>
      ) : null}
    </div>
  );
}
