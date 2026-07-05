import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
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
import { getLocalListenLocalePreference } from "@/i18n/language-preference";
import {
  LISTEN_FALLBACK_LOCALE,
  type ListenLocale,
  toSupportedListenLocale,
} from "@/i18n/locales";
import {
  getI18nServerCacheId,
  LISTEN_I18N_SOURCE_VERSION,
  readCachedBundle,
  refreshCachedRemoteBundle,
} from "@/i18n/remote-bundles";
import {
  findUnsupportedLocaleRequestCandidate,
  requestUnsupportedLocaleTranslation,
} from "@/i18n/translation-request";

const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  it: { translation: it },
  ca: { translation: ca },
  eu: { translation: eu },
};

function withCachedRemoteBundle(locale: ListenLocale) {
  const cached = readCachedBundle(
    getI18nServerCacheId(),
    locale,
    LISTEN_I18N_SOURCE_VERSION,
  );
  if (!cached) return resources;

  return {
    ...resources,
    [locale]: {
      translation: {
        ...resources[locale].translation,
        ...cached,
      },
    },
  };
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages;
}

export function createListenI18n(initialLocale?: ListenLocale) {
  const instance = i18next.createInstance();
  const locale =
    initialLocale ??
    detectPreferredLocale({
      devicePreference: getLocalListenLocalePreference(),
      browserLanguages: browserLanguages(),
    });
  void instance
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources: withCachedRemoteBundle(locale),
      lng: locale,
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

  useEffect(() => {
    if (initialLocale || getLocalListenLocalePreference()) return;

    const candidate = findUnsupportedLocaleRequestCandidate(browserLanguages());
    if (!candidate) return;

    void requestUnsupportedLocaleTranslation(candidate.detectedLocale);
  }, [initialLocale]);

  useEffect(() => {
    let cancelled = false;

    const refresh = (language?: string) => {
      const locale = toSupportedListenLocale(language);
      if (!locale) return;

      const cached = readCachedBundle(
        getI18nServerCacheId(),
        locale,
        LISTEN_I18N_SOURCE_VERSION,
      );
      if (cached) {
        i18n.addResourceBundle(locale, "translation", cached, true, true);
      }

      void refreshCachedRemoteBundle(locale).then((messages) => {
        if (cancelled || !messages) return;
        i18n.addResourceBundle(locale, "translation", messages, true, true);
        if (toSupportedListenLocale(i18n.language) === locale) {
          void i18n.changeLanguage(locale);
        }
      });
    };

    refresh(i18n.resolvedLanguage ?? i18n.language);
    i18n.on("languageChanged", refresh);

    return () => {
      cancelled = true;
      i18n.off("languageChanged", refresh);
    };
  }, [i18n]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
