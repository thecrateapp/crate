import { describe, expect, it } from "vitest";

import ca from "@/i18n/catalogs/ca.json";
import de from "@/i18n/catalogs/de.json";
import en from "@/i18n/catalogs/en.json";
import es from "@/i18n/catalogs/es.json";
import eu from "@/i18n/catalogs/eu.json";
import fr from "@/i18n/catalogs/fr.json";
import itMessages from "@/i18n/catalogs/it.json";

const catalogs = { es, fr, de, it: itMessages, ca, eu };

describe("listen i18n catalogs", () => {
  it("keeps every local catalog aligned with English keys", () => {
    const englishKeys = Object.keys(en).sort();

    for (const [locale, messages] of Object.entries(catalogs)) {
      expect(Object.keys(messages).sort()).toEqual(englishKeys);
      expect(locale).toBeTruthy();
    }
  });
});
