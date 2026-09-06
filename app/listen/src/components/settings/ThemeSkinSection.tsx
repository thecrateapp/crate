import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Section } from "@/components/settings/SettingsPrimitives";
import {
  applyThemeSkin,
  readStoredThemeSkin,
  resolveThemeSkin,
  SKIN_REGISTRY,
  THEME_REGISTRY,
  type ThemeId,
  type SkinId,
} from "@crate/ui/lib/theme-skin";

const THEME_OPTIONS = Object.values(THEME_REGISTRY).map((theme) => ({
  id: theme.id as ThemeId,
  label: theme.label,
}));
const SKIN_OPTIONS = Object.values(SKIN_REGISTRY).map((skin) => ({
  id: skin.id as SkinId,
  label: skin.label,
}));

const selectionButtonClass = (selected: boolean) =>
  `rounded-lg border px-3 py-3 text-left transition-colors ${
    selected
      ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
      : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
  }`;

export function ThemeSkinSection() {
  const { t } = useTranslation();
  const [selection, setSelection] = useState(readStoredThemeSkin);

  const selectTheme = (theme: ThemeId) => {
    setSelection(applyThemeSkin(theme, selection.skin));
  };

  const selectSkin = (skin: SkinId) => {
    setSelection(applyThemeSkin(selection.theme, skin));
  };

  return (
    <Section
      title={t("settings.appearance.title")}
      description={t("settings.appearance.description")}
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-text-secondary">
            {t("settings.appearance.themeLabel")}
          </p>
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("settings.appearance.themeLabel")}
          >
            {THEME_OPTIONS.map((theme) => {
              const selected = selection.theme === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => selectTheme(theme.id)}
                  className={selectionButtonClass(selected)}
                >
                  <span className="block text-sm font-semibold">
                    {t(`settings.appearance.themes.${theme.id}`, {
                      defaultValue: theme.label,
                    })}
                  </span>
                </button>
              );
            })}
          </div>
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
              const supported =
                resolveThemeSkin(selection.theme, skin.id).skin === skin.id;
              return (
                <button
                  key={skin.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-describedby={`theme-skin-${skin.id}-description${
                    supported ? "" : ` theme-skin-${skin.id}-availability`
                  }`}
                  disabled={!supported}
                  onClick={() => selectSkin(skin.id)}
                  className={`${selectionButtonClass(selected)} ${
                    supported ? "" : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <span className="block text-sm font-semibold">
                    {t(`settings.appearance.skinNames.${skin.id}`, {
                      defaultValue: skin.label,
                    })}
                  </span>
                  <span
                    id={`theme-skin-${skin.id}-description`}
                    className="mt-1 block text-xs text-text-muted"
                  >
                    {t(`settings.appearance.skins.${skin.id}`)}
                  </span>
                  {!supported && (
                    <span
                      id={`theme-skin-${skin.id}-availability`}
                      className="sr-only"
                    >
                      {t("settings.appearance.skinUnavailable")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}
