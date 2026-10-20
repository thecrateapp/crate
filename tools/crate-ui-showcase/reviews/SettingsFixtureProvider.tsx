import type { ReactNode } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
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
export function SettingsFixtureProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
