import { useTranslation } from "react-i18next";
import type { ListenLocale } from "../../i18n/locales";
import { Section, SelectRow } from "./SettingsPrimitives";
export function LanguageSettingsView({
  selection,
  activeLanguage,
  options,
  onChange,
}: {
  selection: "auto" | ListenLocale;
  activeLanguage: string;
  options: { value: ListenLocale; label: string }[];
  onChange: (value: "auto" | ListenLocale) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section
      title={t("settings.language.title")}
      description={t("settings.language.description")}
    >
      <SelectRow
        label={t("settings.language.title")}
        value={selection}
        onChange={onChange}
        options={[
          {
            value: "auto",
            label: t("settings.language.auto"),
            description: t("settings.language.autoDescription"),
          },
          ...options,
        ]}
      />
      <p className="text-caption text-text-muted">
        {t("settings.language.current", { language: activeLanguage })}
      </p>
    </Section>
  );
}
