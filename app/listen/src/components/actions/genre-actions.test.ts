import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { buildGenreActions, genrePagePath } from "./genre-actions";

const t = ((key: string) => key) as unknown as TFunction;

describe("buildGenreActions", () => {
  const genre = { slug: "post-hardcore", name: "Post-hardcore" };

  it("builds open, radio and share entries", () => {
    const entries = buildGenreActions(
      {
        genre,
        onOpen: vi.fn(),
        onStartRadio: vi.fn(),
        onShare: vi.fn(),
      },
      t,
    );
    expect(entries.map((entry) => entry.key)).toEqual([
      "open",
      "play-radio",
      "share",
    ]);
    expect(
      entries.map((entry) => ("label" in entry ? entry.label : null)),
    ).toEqual([
      "actions.genre.open",
      "genre.actions.playRadio",
      "genre.actions.share",
    ]);
  });

  it("only includes optional entries when handlers exist", () => {
    expect(
      buildGenreActions({ genre, onOpen: vi.fn() }, t).map(
        (entry) => entry.key,
      ),
    ).toEqual(["open"]);
  });

  it("builds explore genre paths", () => {
    expect(genrePagePath("post hardcore")).toBe(
      "/explore?genre=post%20hardcore",
    );
  });
});
