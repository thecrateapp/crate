import i18next from "i18next";
import ICU from "i18next-icu";
import { beforeAll, describe, expect, it } from "vitest";

import en from "@/i18n/catalogs/en.json";
import es from "@/i18n/catalogs/es.json";
import type { SharePayload } from "@/lib/social-share";
import {
  buildLocalizedShareText,
  buildShareCardLabels,
} from "@/lib/social-share-labels";

const i18n = i18next.createInstance();

beforeAll(async () => {
  i18n.use(new ICU());
  await i18n.init({
    resources: { en: { translation: en }, es: { translation: es } },
    lng: "es",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
});

const crate: SharePayload = {
  kind: "crate",
  title: "Discos del año",
  subtitle: "Diego",
  crateOwnerName: "Diego",
  url: "https://listen.example/share/crate/1",
  crateIsOrdered: true,
  crateTrackCount: 52,
  crateAlbums: [
    { imageUrl: null, name: "One", artistName: "A", position: 0 },
    { imageUrl: null, name: "Two", artistName: "B", position: 1 },
    { imageUrl: null, name: "Three", artistName: "C", position: 2 },
  ],
};

describe("social share labels", () => {
  it("localizes the Crate chat text", () => {
    expect(buildLocalizedShareText(i18n.t, crate)).toBe(
      "«Discos del año» — Crate de Diego · 3 álbumes",
    );
    expect(
      buildLocalizedShareText(i18n.t, {
        ...crate,
        subtitle: null,
        crateOwnerName: null,
        crateAlbumCount: 1,
      }),
    ).toBe("«Discos del año» — Crate · 1 álbum");
  });

  it("keeps the generic chat text for other kinds", () => {
    expect(
      buildLocalizedShareText(i18n.t, {
        kind: "album",
        title: "Blending",
        subtitle: "High Vis",
        url: "https://listen.example/share/album/1",
      }),
    ).toBe("Blending - High Vis");
  });

  it("builds localized card labels for Crates", () => {
    expect(buildShareCardLabels(i18n.t, crate)).toEqual({
      subtitle: "Crate de Diego",
      metadata: "3 álbumes · 52 canciones",
      kicker: "Ranking",
      cta: "Escúchalo en Crate",
    });
    expect(
      buildShareCardLabels(i18n.t, { ...crate, crateIsOrdered: false }).kicker,
    ).toBe("Selección");
  });

  it("builds localized card subtitles for tracks", () => {
    expect(
      buildShareCardLabels(i18n.t, {
        kind: "track",
        title: "Los Monos",
        subtitle: "La Polla Records",
        url: "https://listen.example/share/track/1",
      }).subtitle,
    ).toBe("Canción de La Polla Records");
  });
});
