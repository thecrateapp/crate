import { describe, expect, it, vi } from "vitest";

import ca from "@/i18n/catalogs/ca.json";
import de from "@/i18n/catalogs/de.json";
import en from "@/i18n/catalogs/en.json";
import es from "@/i18n/catalogs/es.json";
import eu from "@/i18n/catalogs/eu.json";
import fr from "@/i18n/catalogs/fr.json";
import itMessages from "@/i18n/catalogs/it.json";
import { createListenI18n, type ListenResources } from "@/i18n/I18nProvider";
import { ApiError } from "@/lib/api";
import { smartMixLimit, smartMixLimitMessage } from "@/lib/smart-mix-playlists";

const resources = {
  ca: { translation: ca },
  de: { translation: de },
  en: { translation: en },
  es: { translation: es },
  eu: { translation: eu },
  fr: { translation: fr },
  it: { translation: itMessages },
} as ListenResources;

async function tFor(locale: keyof typeof resources) {
  const instance = createListenI18n(locale as never, resources);
  await vi.waitFor(() => expect(instance.isInitialized).toBe(true));
  return instance.t;
}

function conflict(body: unknown) {
  return new ApiError(409, JSON.stringify(body));
}

describe("Smart Mix limits", () => {
  it("reads the structured 409 and nothing else", () => {
    expect(
      smartMixLimit(
        conflict({
          detail: "A Smart Mix playlist holds at most 300 tracks",
          limit: "playlist",
          maxTracks: 300,
          tracks: 412,
        }),
      ),
    ).toEqual({ limit: "playlist", maxTracks: 300, tracks: 412 });
    // An older server's plain detail, another status or another error.
    expect(smartMixLimit(conflict({ detail: "too many" }))).toBeNull();
    expect(smartMixLimit(new ApiError(409, "not json"))).toBeNull();
    expect(
      smartMixLimit(
        new ApiError(
          403,
          JSON.stringify({ limit: "user", maxTracks: 1, tracks: 2 }),
        ),
      ),
    ).toBeNull();
    expect(smartMixLimit(new Error("offline"))).toBeNull();
  });

  it("translates the 409 from its fields in English", async () => {
    const t = await tFor("en");
    expect(
      smartMixLimitMessage(
        { limit: "playlist", maxTracks: 300, tracks: 412 },
        "Domingo",
        t,
      ),
    ).toEqual({
      title: "Smart Mix stays off for Domingo",
      description:
        "A Smart Mix playlist holds at most 300 tracks on this server; Domingo has 412.",
    });
    expect(
      smartMixLimitMessage(
        { limit: "user", maxTracks: 900, tracks: 960 },
        "Domingo",
        t,
      ).description,
    ).toBe(
      "Your Smart Mix playlists hold at most 900 tracks together on this server; with Domingo they would hold 960.",
    );
  });

  it.each(["ca", "de", "es", "eu", "fr", "it"] as const)(
    "translates the 409 into %s with the name and both numbers",
    async (locale) => {
      const t = await tFor(locale);
      const english = await tFor("en");
      for (const limit of ["playlist", "user"] as const) {
        const message = smartMixLimitMessage(
          { limit, maxTracks: 300, tracks: 412 },
          "Domingo",
          t,
        );
        const source = smartMixLimitMessage(
          { limit, maxTracks: 300, tracks: 412 },
          "Domingo",
          english,
        );
        expect(message.title).toContain("Domingo");
        expect(message.description).toMatch(/300/);
        expect(message.description).toMatch(/412/);
        expect(message.description).toContain("Domingo");
        expect(message.title).not.toBe(source.title);
        expect(message.description).not.toBe(source.description);
      }
    },
  );
});
