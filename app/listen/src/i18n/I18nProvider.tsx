import type { ReactNode } from "react";
import { useMemo } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";

import ca from "@/i18n/catalogs/ca.json";
import de from "@/i18n/catalogs/de.json";
import en from "@/i18n/catalogs/en.json";
import es from "@/i18n/catalogs/es.json";
import eu from "@/i18n/catalogs/eu.json";
import fr from "@/i18n/catalogs/fr.json";
import it from "@/i18n/catalogs/it.json";
import { detectPreferredLocale } from "@/i18n/language-detector";
import { LISTEN_FALLBACK_LOCALE, type ListenLocale } from "@/i18n/locales";

const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  it: { translation: it },
  ca: { translation: ca },
  eu: { translation: eu },
};

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages;
}

export function createListenI18n(initialLocale?: ListenLocale) {
  const instance = i18next.createInstance();
  void instance
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources,
      lng:
        initialLocale ??
        detectPreferredLocale({
          browserLanguages: browserLanguages(),
        }),
      fallbackLng: LISTEN_FALLBACK_LOCALE,
      keySeparator: false,
      interpolation: { escapeValue: false },
    });
  return instance;
}

interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: ListenLocale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const i18n = useMemo(() => createListenI18n(initialLocale), [initialLocale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
