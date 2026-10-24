import { describe, expect, it } from "vitest";

import type { HomeGeneratedPlaylistDetail } from "@/components/home/home-model";

import { newArrivalsWindowLabel } from "./HomePlaylist";
import { createListenI18n } from "@/i18n/I18nProvider";
import en from "@/i18n/catalogs/en.json";
import es from "@/i18n/catalogs/es.json";
const resources = { en: { translation: en }, es: { translation: es } };
const english = createListenI18n("en", resources);
const spanish = createListenI18n("es", resources);

function playlist(
  tracks: HomeGeneratedPlaylistDetail["tracks"],
): HomeGeneratedPlaylistDetail {
  return {
    id: "my-new-arrivals",
    name: "My New Arrivals",
    description: "",
    artwork_tracks: [],
    artwork_artists: [],
    track_count: tracks.length,
    total_duration: 0,
    badge: "Mix",
    kind: "mix",
    tracks,
  };
}

describe("newArrivalsWindowLabel", () => {
  it("returns the single release-week label", () => {
    expect(
      newArrivalsWindowLabel(
        playlist([
          {
            title: "Track",
            artist: "Artist",
            release_week_index: 0,
            release_week_label: "Untrusted backend label",
          },
        ]),
        english.t,
      ),
    ).toBe("This week");
  });

  it("summarizes multiple release-week buckets", () => {
    expect(
      newArrivalsWindowLabel(
        playlist([
          {
            title: "Current",
            artist: "Artist",
            release_week_index: 0,
            release_week_label: "This week",
          },
          {
            title: "Previous",
            artist: "Artist",
            release_week_index: 2,
            release_week_label: "2 weeks ago",
          },
        ]),
        english.t,
      ),
    ).toBe("This week + 2 previous weeks");
  });

  it("ignores non-new-arrivals playlists", () => {
    const data = playlist([]);
    data.id = "daily-discovery";

    expect(newArrivalsWindowLabel(data, english.t)).toBeNull();
  });

  it.each([
    [[0], "Esta semana"],
    [[1], "La semana pasada"],
    [[3], "Hace 3 semanas"],
    [[0, 1], "Esta semana + 1 semana anterior"],
    [[0, 2], "Esta semana + 2 semanas anteriores"],
    [[1, 2], "2 semanas de lanzamientos anteriores"],
  ] as const)(
    "localizes release-week indices %j without using backend copy",
    (indices, expected) => {
      const data = playlist(
        indices.map((index) => ({
          title: "Track",
          artist: "Artist",
          release_week_index: index,
          release_week_label: "ENGLISH BACKEND COPY",
        })),
      );
      expect(newArrivalsWindowLabel(data, spanish.t)).toBe(expected);
    },
  );
});
