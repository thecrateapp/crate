import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import {
  getUiPreferences,
  setUiPreferences,
  subscribeUiPreferences,
  type UiPreferences,
} from "@crate/ui/lib/interface-preferences";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { Section } from "./SettingsPrimitives";

type PreferencePatch = Partial<Omit<UiPreferences, "version">>;

interface PreferenceLabels {
  title: string;
  description: string;
  motionLabel: string;
  effectsLabel: string;
  densityLabel: string;
  values: Record<string, string>;
}

export function InterfacePreferencesControls({
  preferences,
  onChange,
  labels,
}: {
  preferences: UiPreferences;
  onChange: (patch: PreferencePatch) => void;
  labels: PreferenceLabels;
}) {
  const fields = [
    { key: "motion", label: labels.motionLabel, values: ["system", "reduced"] },
    {
      key: "effects",
      label: labels.effectsLabel,
      values: ["off", "subtle", "expressive"],
    },
    {
      key: "density",
      label: labels.densityLabel,
      values: ["comfortable", "compact"],
    },
  ] as const;

  return (
    <Section title={labels.title} description={labels.description}>
      {fields.map((field) => (
        <div
          key={field.key}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <span className="text-sm font-medium text-text-primary">
            {field.label}
          </span>
          <Select
            value={preferences[field.key]}
            onValueChange={(value) =>
              onChange({ [field.key]: value } as PreferencePatch)
            }
          >
            <SelectTrigger aria-label={field.label} className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.values.map((value) => (
                <SelectItem key={value} value={value}>
                  {labels.values[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </Section>
  );
}

export function InterfacePreferencesSection() {
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
