import type { ReactNode } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import basque from "../../../app/listen/src/i18n/catalogs/eu.json";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
const basqueI18n = i18next.createInstance();
void basqueI18n
  .use(new ICU())
  .init({
    resources: { eu: { translation: basque } },
    lng: "eu",
    fallbackLng: "eu",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
export function SettingsFixtureProvider({
  children,
  locale = "en",
}: {
  children: ReactNode;
  locale?: "en" | "eu";
}) {
  return (
    <I18nextProvider i18n={locale === "eu" ? basqueI18n : i18n}>
      {children}
    </I18nextProvider>
  );
}
