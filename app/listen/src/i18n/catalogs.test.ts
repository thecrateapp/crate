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
const fullyLocalizedLibraryPrefixes = ["library."] as const;
const completedLibraryEnglishFallbackAllowlist = new Set<string>([
  "library.bandcamp.stats.inCrate",
  "library.sort.selectedAria",
]);
const fullyLocalizedHomePrefixes = [
  "home.loading",
  "home.library.",
  "home.radar.",
  "home.radio.",
  "home.sections.",
] as const;
const completedHomeEnglishFallbackAllowlist = new Set<string>([
  "home.radar.title",
  "home.radar.meta.date",
  "home.sections.listeningDna.title",
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
const fullyLocalizedCommonPrefixes = ["common."] as const;
const completedCommonEnglishFallbackAllowlist = new Set<string>([
  "common.off",
  "common.offline",
  "common.album",
  "common.name",
  "common.password",
  "common.email",
  "common.source",
  "common.recent",
  "common.playlistCountLabel",
  "common.secondsShort",
  "common.albumCountLabel",
]);
const fullyLocalizedGenrePrefixes = ["genre."] as const;
const completedGenreEnglishFallbackAllowlist = new Set<string>([
  "genre.kind",
  "genre.sections.shows",
]);
const fullyLocalizedRadioPrefixes = ["radio."] as const;
const completedRadioEnglishFallbackAllowlist = new Set<string>([
  "radio.title",
  "radio.discovery",
]);
const fullyLocalizedAlbumPrefixes = ["album."] as const;
const completedAlbumEnglishFallbackAllowlist = new Set<string>(["album.disc"]);
const fullyLocalizedUploadPrefixes = ["upload."] as const;
const fullyLocalizedPathsPrefixes = ["paths."] as const;
const fullyLocalizedPeoplePrefixes = ["people."] as const;
const fullyLocalizedUserConnectionsPrefixes = ["userConnections."] as const;
const fullyLocalizedAuthCallbackPrefixes = ["authCallback."] as const;
const fullyLocalizedPlaylistInvitePrefixes = ["playlistInvite."] as const;
const fullyLocalizedJamInvitePrefixes = ["jamInvite."] as const;
const fullyLocalizedArtistAllPrefixes = ["artist."] as const;
const completedArtistAllFallbackAllowlist = new Set<string>([
  "artist.sections.albums",
  "artist.actions.setlist",
]);
const fullyLocalizedExplorePrefixes = ["explore."] as const;
const completedExploreFallbackAllowlist = new Set<string>([
  "explore.features.radio.title",
]);
const fullyLocalizedServerSetupPrefixes = ["serverSetup."] as const;
const completedServerSetupFallbackAllowlist = new Set<string>([
  "serverSetup.docsSuffix",
]);
const fullyLocalizedUserMenuPrefixes = ["userMenu."] as const;
const completedUserMenuFallbackAllowlist = new Set<string>([
  "userMenu.stats",
  "userMenu.suggest.badge",
  "userMenu.suggest.noteLabel",
]);
const fullyLocalizedRadarPrefixes = ["radar."] as const;
const completedRadarFallbackAllowlist = new Set<string>([
  "radar.release.preRelease",
]);
const fullyLocalizedUserProfilePrefixes = ["userProfile."] as const;
const completedUserProfileFallbackAllowlist = new Set<string>([
  "userProfile.topGenreStats",
  "userProfile.contributions.via",
]);
const fullyLocalizedPlaylistPrefixes = ["playlist."] as const;
const completedPlaylistFallbackAllowlist = new Set<string>([
  "playlist.badges.smart",
  "playlist.collaborators.collab",
]);
const fullyLocalizedUtilityPrefixes = [
  "bandcamp.tasks.",
  "common.toasts.",
] as const;
const fullyLocalizedComposerPrefixes = [
  "playlistComposer.",
  "profileHover.",
] as const;
const completedComposerEnglishFallbackAllowlist = new Set<string>([
  "playlistComposer.descriptionLabel",
  "playlistComposer.playlistLabel",
]);

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

  it("keeps completed composer and profile hover blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedComposerPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedComposerEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed common blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedCommonPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedCommonEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed genre blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedGenrePrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedGenreEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed radio blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedRadioPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedRadioEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed album blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedAlbumPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedAlbumEnglishFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed upload blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedUploadPrefixes) {
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

  it("keeps completed paths blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedPathsPrefixes) {
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

  it("keeps completed people blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedPeoplePrefixes) {
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

  it("keeps completed user connections blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedUserConnectionsPrefixes) {
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

  it("keeps completed auth callback blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedAuthCallbackPrefixes) {
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

  it("keeps completed playlist invite blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedPlaylistInvitePrefixes) {
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

  it("keeps completed jam invite blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedJamInvitePrefixes) {
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

  it("keeps completed artist blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedArtistAllPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedArtistAllFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed explore blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedExplorePrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedExploreFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed server setup blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedServerSetupPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedServerSetupFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed user menu blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedUserMenuPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedUserMenuFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed radar blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedRadarPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedRadarFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed user profile blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedUserProfilePrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedUserProfileFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });

  it("keeps completed playlist blocks from falling back to English copy", () => {
    for (const prefix of fullyLocalizedPlaylistPrefixes) {
      const keys = Object.keys(enMessages).filter((key) =>
        key.startsWith(prefix),
      );

      for (const [locale, messages] of Object.entries(catalogs)) {
        for (const key of keys) {
          if (completedPlaylistFallbackAllowlist.has(key)) continue;
          expect(messages[key], `${locale}.${key}`).not.toBe(enMessages[key]);
        }
      }
    }
  });
});
