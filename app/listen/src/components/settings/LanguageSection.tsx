import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LanguageSettingsView } from "./LanguageSettingsView";
import {
  clearLocalListenLocalePreference,
  getLocalListenLocalePreference,
  setLocalListenLocalePreference,
} from "@/i18n/language-preference";
import { detectPreferredLocale } from "@/i18n/language-detector";
import {
  LISTEN_SUPPORTED_LOCALES,
  type ListenLocale,
  toSupportedListenLocale,
} from "@/i18n/locales";

type LanguageSelection = "auto" | ListenLocale;

const LANGUAGE_OPTIONS: { value: ListenLocale; labelKey: string }[] =
  LISTEN_SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    labelKey: `settings.language.options.${locale}`,
  }));

function getAutomaticListenLocale(): ListenLocale {
  return detectPreferredLocale({
    browserLanguages:
      typeof navigator === "undefined" ? [] : navigator.languages,
  });
}

export function LanguageSection({
  i18n,
}: {
  i18n: ReturnType<typeof useTranslation>["i18n"];
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<LanguageSelection>(
    () => getLocalListenLocalePreference() ?? "auto",
  );
  const activeLocale =
    selection === "auto"
      ? (toSupportedListenLocale(i18n.resolvedLanguage) ??
        getAutomaticListenLocale())
      : selection;

  const changeLanguage = (nextSelection: LanguageSelection) => {
    setSelection(nextSelection);
    const nextLocale =
      nextSelection === "auto" ? getAutomaticListenLocale() : nextSelection;

    if (nextSelection === "auto") {
      clearLocalListenLocalePreference();
    } else {
      setLocalListenLocalePreference(nextSelection);
    }

    void i18n.changeLanguage(nextLocale);
  };

  return (
    <LanguageSettingsView
      selection={selection}
      activeLanguage={t(`settings.language.options.${activeLocale}`)}
      options={LANGUAGE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      }))}
      onChange={changeLanguage}
    />
  );
}
