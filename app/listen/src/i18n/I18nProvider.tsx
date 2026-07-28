import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import i18next from "i18next";
import type { i18n, PostProcessorModule } from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";

import { loadListenCatalog, type ListenCatalog } from "@/i18n/catalog-loader";
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
import { withTranslationMarker } from "@/i18n/translation-mode/markers";

const TRANSLATION_MARKER_POST_PROCESSOR = "crateTranslationMarker";

const translationMarkerPostProcessor: PostProcessorModule = {
  name: TRANSLATION_MARKER_POST_PROCESSOR,
  type: "postProcessor",
  process(value, key, options, translator) {
    const keyName = Array.isArray(key) ? key[0] : key;
    if (!keyName) {
      return value;
    }
    const locale =
      typeof options.lng === "string"
        ? options.lng
        : typeof translator?.language === "string"
          ? translator.language
          : undefined;

    return withTranslationMarker(value, keyName, locale);
  },
};

export type ListenResources = Partial<
  Record<ListenLocale, { translation: ListenCatalog }>
>;

type ListenTestGlobal = typeof globalThis & {
  __CRATE_LISTEN_TEST_I18N_RESOURCES__?: ListenResources;
};

function getSynchronousTestResources(): ListenResources | undefined {
  return (globalThis as ListenTestGlobal).__CRATE_LISTEN_TEST_I18N_RESOURCES__;
}

function withCachedRemoteBundle(
  locale: ListenLocale,
  resources: ListenResources,
) {
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
        ...(resources[locale]?.translation ?? {}),
        ...cached,
      },
    },
  };
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages;
}

function resolveInitialLocale(initialLocale?: ListenLocale): ListenLocale {
  return (
    initialLocale ??
    detectPreferredLocale({
      devicePreference: getLocalListenLocalePreference(),
      browserLanguages: browserLanguages(),
    })
  );
}

async function loadInitialResources(
  locale: ListenLocale,
): Promise<ListenResources> {
  const locales = new Set<ListenLocale>([LISTEN_FALLBACK_LOCALE, locale]);
  const loaded = await Promise.all(
    [...locales].map(async (current) => [
      current,
      await loadListenCatalog(current),
    ]),
  );
  return Object.fromEntries(
    loaded.map(([current, translation]) => [current, { translation }]),
  ) as ListenResources;
}

export function createListenI18n(
  initialLocale: ListenLocale,
  resources: ListenResources,
) {
  const instance = i18next.createInstance();
  const translationModeEnabled =
    import.meta.env.DEV && import.meta.env.VITE_TRANSLATION_MODE === "1";
  instance.use(new ICU({ bindI18nStore: "added removed" }));
  if (translationModeEnabled) {
    instance.use(translationMarkerPostProcessor);
  }
  void instance.use(initReactI18next).init({
    resources: withCachedRemoteBundle(initialLocale, resources),
    lng: initialLocale,
    fallbackLng: LISTEN_FALLBACK_LOCALE,
    keySeparator: false,
    interpolation: { escapeValue: false },
    react: { bindI18nStore: "added removed" },
    postProcess: translationModeEnabled
      ? [TRANSLATION_MARKER_POST_PROCESSOR]
      : undefined,
  });
  return instance;
}

interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: ListenLocale;
}

interface ReadyI18nProviderProps {
  children: ReactNode;
  i18n: i18n;
}

function ReadyI18nProvider({ children, i18n }: ReadyI18nProviderProps) {
  useEffect(() => {
    let cancelled = false;

    const refresh = (language?: string) => {
      const locale = toSupportedListenLocale(language);
      if (!locale) return;

      void loadListenCatalog(locale).then((localMessages) => {
        if (cancelled) return;
        i18n.addResourceBundle(
          locale,
          "translation",
          localMessages,
          true,
          false,
        );

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
        });
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

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const locale = useMemo(
    () => resolveInitialLocale(initialLocale),
    [initialLocale],
  );
  const testResources = getSynchronousTestResources();
  const [i18n, setI18n] = useState<i18n | null>(() =>
    testResources ? createListenI18n(locale, testResources) : null,
  );

  useEffect(() => {
    if (testResources) {
      setI18n((current) => {
        const currentLocale = toSupportedListenLocale(
          current?.resolvedLanguage ?? current?.language,
        );
        return current && currentLocale === locale
          ? current
          : createListenI18n(locale, testResources);
      });
      return;
    }

    let cancelled = false;
    void loadInitialResources(locale).then((resources) => {
      if (!cancelled) {
        setI18n(createListenI18n(locale, resources));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [locale, testResources]);

  useEffect(() => {
    if (initialLocale || getLocalListenLocalePreference()) return;

    const candidate = findUnsupportedLocaleRequestCandidate(browserLanguages());
    if (!candidate) return;

    void requestUnsupportedLocaleTranslation(candidate.detectedLocale);
  }, [initialLocale]);

  if (!i18n) return null;
  return <ReadyI18nProvider i18n={i18n}>{children}</ReadyI18nProvider>;
}
