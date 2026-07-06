import { describe, expect, it } from "vitest";

import ca from "@/i18n/catalogs/ca.json";
import de from "@/i18n/catalogs/de.json";
import en from "@/i18n/catalogs/en.json";
import es from "@/i18n/catalogs/es.json";
import eu from "@/i18n/catalogs/eu.json";
import fr from "@/i18n/catalogs/fr.json";
import itMessages from "@/i18n/catalogs/it.json";
import {
  CONTAINED_PRODUCT_TERM_KEYS,
  EXACT_PRODUCT_TERM_KEYS,
  PRODUCT_TERMS,
} from "@/i18n/product-terms";

type CatalogMessages = Record<string, string>;

const enMessages: CatalogMessages = en;
const catalogs: Record<string, CatalogMessages> = {
  es,
  fr,
  de,
  it: itMessages,
  ca,
  eu,
};
const allCatalogs: Record<string, CatalogMessages> = {
  en: enMessages,
  ...catalogs,
};
const fullyLocalizedPrefixes = [
  "settings.connectDevices.",
  "settings.playback.",
  "settings.bandcamp.",
  "settings.account.",
  "settings.shows.",
  "settings.offline.",
  "settings.scrobbling.",
  "settings.sleep.",
] as const;
const completedSettingsEnglishFallbackAllowlist = new Set<string>([
  "settings.playback.crossfade",
  "settings.sleep.modes.15min",
  "settings.sleep.modes.30min",
  "settings.sleep.modes.45min",
]);
const fullyLocalizedStatsPrefixes = [
  "stats.story.",
  "stats.rhythm.",
  "stats.replay.",
  "stats.topTracks.",
  "stats.topArtists.",
  "stats.topAlbums.",
  "stats.trend.",
] as const;
const completedStatsEnglishFallbackAllowlist = new Set<string>([
  "stats.replay.title",
]);
const fullyLocalizedPlayerPrefixes = [
  "player.loading",
  "player.lyrics.",
  "player.queue.",
  "player.toasts.",
  "player.equalizer.",
  "player.info.",
] as const;
const completedPlayerEnglishFallbackAllowlist = new Set<string>([
  "player.equalizer.genre.label",
  "player.info.metric.valence",
]);
const fullyLocalizedLibraryPrefixes = [
  "library.bandcamp.",
  "library.contributions.",
] as const;
const completedLibraryEnglishFallbackAllowlist = new Set<string>([
  "library.bandcamp.stats.inCrate",
]);
const fullyLocalizedHomePrefixes = [
  "home.library.",
  "home.radar.",
  "home.section.",
] as const;
const completedHomeEnglishFallbackAllowlist = new Set<string>([
  "home.radar.title",
  "home.radar.meta.date",
]);
const fullyLocalizedBandcampPrefixes = ["bandcamp.toasts."] as const;
const fullyLocalizedNextCutPrefixes = [
  "jam.room.",
  "playlist.toasts.",
  "home.toasts.",
  "home.playlists.",
  "explore.decade.",
  "explore.playlistCategory.",
  "bandcamp.stats.",
  "bandcamp.rails.",
  "nav.",
  "search.",
  "share.",
] as const;
const completedNextCutEnglishFallbackAllowlist = new Set<string>([
  "jam.room.sessionFallback",
  "jam.room.roles.host",
  "jam.room.roles.collab",
  "jam.room.descriptionLabel",
  "jam.room.tagsLabel",
  "jam.room.tagsPlaceholder",
  "bandcamp.stats.radar",
  "bandcamp.stats.wishlist",
  "bandcamp.rails.radar.title",
  "bandcamp.rails.wishlist.title",
  "nav.home",
  "nav.collection",
  "nav.radar",
  "nav.collection.playlists",
  "nav.collection.albums",
  "nav.collection.bandcamp",
  "nav.collection.contributions",
  "search.recent",
  "search.resultType.artist",
  "search.resultType.album",
  "search.resultType.track",
  "search.resultType.playlist",
  "search.albumsCount",
  "share.kind.album",
  "share.kind.playlist",
  "share.instagramStory",
]);
const fullyLocalizedActionPrefixes = [
  "actions.track.",
  "actions.playlist.",
] as const;
const completedActionEnglishFallbackAllowlist = new Set<string>([
  "actions.track.playlists",
]);
const fullyLocalizedArtistPrefixes = ["artist.sections."] as const;
const completedArtistEnglishFallbackAllowlist = new Set<string>([
  "artist.sections.albums",
]);
const fullyLocalizedUtilityPrefixes = [
  "bandcamp.tasks.",
  "common.toasts.",
] as const;

describe("listen i18n catalogs", () => {
  it("keeps every local catalog aligned with English keys", () => {
    const englishKeys = Object.keys(en).sort();

    for (const [locale, messages] of Object.entries(catalogs)) {
      expect(Object.keys(messages).sort()).toEqual(englishKeys);
      expect(locale).toBeTruthy();
    }
  });

  it("keeps product feature names untranslated across every locale", () => {
    for (const [locale, messages] of Object.entries(allCatalogs)) {
      for (const [key, expected] of EXACT_PRODUCT_TERM_KEYS) {
        expect(messages[key], `${locale}.${key}`).toBe(expected);
      }
      for (const [key, expected] of CONTAINED_PRODUCT_TERM_KEYS) {
        expect(messages[key], `${locale}.${key}`).toContain(expected);
      }
    }
  });

  it("translates playback copy around the Crossfade product term", () => {
    for (const [locale, messages] of Object.entries(catalogs)) {
      expect(messages["settings.playback.crossfadeDescription"]).toContain(
        PRODUCT_TERMS.crossfade,
      );
      expect(
        messages["settings.playback.crossfadeDescription"],
        `${locale}.settings.playback.crossfadeDescription`,
      ).not.toBe(enMessages["settings.playback.crossfadeDescription"]);
    }
  });

  it("keeps completed settings blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedSettingsEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed stats blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedStatsPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedStatsEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed player blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedPlayerPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedPlayerEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed library blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedLibraryPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedLibraryEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed home library blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedHomePrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedHomeEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed Bandcamp blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedBandcampPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps the next completed localization blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedNextCutPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedNextCutEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed action, artist, and utility blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedActionPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedActionEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }

    for (const prefix of fullyLocalizedArtistPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedArtistEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }

    for (const prefix of fullyLocalizedUtilityPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });
});
