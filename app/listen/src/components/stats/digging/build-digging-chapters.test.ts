import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { baseDashboard } from "@/test/stats-dashboard-fixture";

import { buildDiggingShareData } from "./build-digging-chapters";

const t = ((key: string) => key) as unknown as TFunction;
const media = {
  albumCover: () => null,
  renderImage: () => null,
  renderArtist: () => null,
  renderDecades: () => null,
};

function topGenreStat(
  genres: NonNullable<ReturnType<typeof baseDashboard>["genre_trend"]>,
) {
  const dashboard = { ...baseDashboard(), genre_trend: genres };
  return buildDiggingShareData(
    dashboard,
    t,
    "kicker",
    "owner",
    media,
  ).stats.find((stat) => stat.label === "stats.digging.topGenre");
}

describe("buildDiggingShareData", () => {
  it("names the first ranked genre, never the appended faller", () => {
    expect(
      topGenreStat([
        { genre_name: "Metalcore", share: 0.4, delta_vs_previous: 0.1 },
        {
          genre_name: "Hardcore",
          share: 0,
          delta_vs_previous: -0.2,
          faller: true,
        },
      ])?.value,
    ).toBe("metalcore");
  });

  it("shows no top genre when only the faller is left", () => {
    expect(
      topGenreStat([
        {
          genre_name: "Hardcore",
          share: 0,
          delta_vs_previous: -0.2,
          faller: true,
        },
      ]),
    ).toBeUndefined();
  });
});
