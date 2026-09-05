import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Section } from "@/components/settings/SettingsPrimitives";
import {
  applyThemeSkin,
  readStoredThemeSkin,
  SKIN_REGISTRY,
  type SkinId,
} from "@crate/ui/lib/theme-skin";

const SKIN_OPTIONS = Object.values(SKIN_REGISTRY).map((skin) => ({
  id: skin.id as SkinId,
  label: skin.label,
}));

export function ThemeSkinSection() {
  const { t } = useTranslation();
  const [selection, setSelection] = useState(readStoredThemeSkin);

  const selectSkin = (skin: SkinId) => {
    setSelection(applyThemeSkin(selection.theme, skin));
  };

  return (
    <Section
      title={t("settings.appearance.title")}
      description={t("settings.appearance.description")}
    >
      <div
        className="grid gap-2 sm:grid-cols-2"
        role="radiogroup"
        aria-label={t("settings.appearance.skinLabel")}
      >
        {SKIN_OPTIONS.map((skin) => {
          const selected = selection.skin === skin.id;
          return (
            <button
              key={skin.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectSkin(skin.id)}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                selected
                  ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
                  : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
              }`}
            >
              <span className="block text-sm font-semibold">{skin.label}</span>
              <span className="mt-1 block text-xs text-text-muted">
                {t(`settings.appearance.skins.${skin.id}`)}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
