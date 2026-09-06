import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Section } from "@/components/settings/SettingsPrimitives";
import {
  applyThemeSkin,
  MODE_REGISTRY,
  readStoredThemeSkin,
  SKIN_REGISTRY,
  type ColorModePreference,
  type SkinId,
} from "@crate/ui/lib/theme-skin";

const MODE_OPTIONS = Object.values(MODE_REGISTRY).map((mode) => ({
  id: mode.id as ColorModePreference,
}));
const SKIN_OPTIONS = Object.values(SKIN_REGISTRY).map((skin) => ({
  id: skin.id as SkinId,
}));

const selectionButtonClass = (selected: boolean) =>
  `rounded-lg border px-3 py-3 text-left transition-colors focus-within:ring-2 focus-within:ring-focus-ring/50 ${
    selected
      ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
      : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
  }`;

export function ThemeSkinSection() {
  const { t } = useTranslation();
  const [selection, setSelection] = useState(readStoredThemeSkin);

  const selectSkin = (skin: SkinId) => {
    const applied = applyThemeSkin(selection.mode, skin);
    setSelection({ mode: applied.mode, skin: applied.skin });
  };

  return (
    <Section
      title={t("settings.appearance.title")}
      description={t("settings.appearance.description")}
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-text-secondary">
            {t("settings.appearance.modeLabel")}
          </p>
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("settings.appearance.modeLabel")}
          >
            {MODE_OPTIONS.map((mode) => {
              const selected = selection.mode === mode.id;
              return (
                <label key={mode.id} className={selectionButtonClass(selected)}>
                  <input
                    type="radio"
                    name="crate-mode"
                    value={mode.id}
                    checked={selected}
                    onChange={() => {
                      const applied = applyThemeSkin(mode.id, selection.skin);
                      setSelection({
                        mode: applied.mode,
                        skin: applied.skin,
                      });
                    }}
                    className="sr-only"
                  />
                  <span className="block text-sm font-semibold">
                    {t(`settings.appearance.modes.${mode.id}`)}
                  </span>
                </label>
              );
            })}
          </div>
          {selection.mode === "system" ? (
            <p className="mt-2 text-xs text-text-muted">
              {t("settings.appearance.systemPreference")}
            </p>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-text-secondary">
            {t("settings.appearance.skinLabel")}
          </p>
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("settings.appearance.skinLabel")}
          >
            {SKIN_OPTIONS.map((skin) => {
              const selected = selection.skin === skin.id;
              return (
                <label key={skin.id} className={selectionButtonClass(selected)}>
                  <input
                    type="radio"
                    name="crate-skin"
                    value={skin.id}
                    checked={selected}
                    onChange={() => selectSkin(skin.id)}
                    aria-describedby={`theme-skin-${skin.id}-description`}
                    className="sr-only"
                  />
                  <span className="block text-sm font-semibold">
                    {t(`settings.appearance.skinNames.${skin.id}`)}
                  </span>
                  <span
                    id={`theme-skin-${skin.id}-description`}
                    className="mt-1 block text-xs text-text-muted"
                  >
                    {t(`settings.appearance.skins.${skin.id}`)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}
