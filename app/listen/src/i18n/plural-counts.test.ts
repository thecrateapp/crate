import { describe, expect, it, vi } from "vitest";

import ca from "@/i18n/catalogs/ca.json";
import de from "@/i18n/catalogs/de.json";
import en from "@/i18n/catalogs/en.json";
import es from "@/i18n/catalogs/es.json";
import eu from "@/i18n/catalogs/eu.json";
import fr from "@/i18n/catalogs/fr.json";
import itMessages from "@/i18n/catalogs/it.json";
import { createListenI18n, type ListenResources } from "@/i18n/I18nProvider";

const resources = {
  ca: { translation: ca },
  de: { translation: de },
  en: { translation: en },
  es: { translation: es },
  eu: { translation: eu },
  fr: { translation: fr },
  it: { translation: itMessages },
} as ListenResources;

const catalogs: Record<string, Record<string, string>> = {
  ca,
  de,
  en,
  es,
  eu,
  fr,
  it: itMessages,
};

const COUNT_KEYS = [
  "common.playCount",
  "common.trackCount",
  "common.followerCount",
  "stats.recap.replayTitle",
  "stats.story.risingBody",
] as const;

async function i18nFor(locale: keyof typeof catalogs) {
  const instance = createListenI18n(locale as never, resources);
  await vi.waitFor(() => expect(instance.isInitialized).toBe(true));
  return instance;
}

describe("count messages", () => {
  it("uses singular forms for a count of one", async () => {
    const esI18n = await i18nFor("es");
    expect(esI18n.t("common.playCount", { count: 1 })).toBe("1 reproducción");
    expect(esI18n.t("common.playCount", { count: 3 })).toBe("3 reproducciones");

    const enI18n = await i18nFor("en");
    expect(enI18n.t("common.trackCount", { count: 1 })).toBe("1 track");
    expect(enI18n.t("common.followerCount", { count: 2 })).toBe("2 followers");
  });

  it("declares count keys as ICU plurals in every catalog", () => {
    for (const [locale, messages] of Object.entries(catalogs)) {
      for (const key of COUNT_KEYS) {
        expect(messages[key], `${locale}:${key}`).toMatch(
          /\{count, plural, one \{[^}]*\} other \{[^}]*\}\}/,
        );
      }
    }
  });
});
