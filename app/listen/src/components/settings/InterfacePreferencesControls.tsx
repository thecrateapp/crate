import type { UiPreferences } from "@crate/ui/lib/interface-preferences";
import { Section, SelectRow } from "./SettingsPrimitives";
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
      <div className="grid min-w-0 gap-5 @md:grid-cols-2 @2xl:grid-cols-3">
        {fields.map((field) => (
          <SelectRow
            key={field.key}
            label={field.label}
            value={preferences[field.key]}
            onChange={(value) =>
              onChange({ [field.key]: value } as PreferencePatch)
            }
            options={field.values.map((value) => ({
              value,
              label: labels.values[value]!,
            }))}
          />
        ))}
      </div>
    </Section>
  );
}
