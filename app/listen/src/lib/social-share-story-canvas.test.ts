import { describe, expect, it } from "vitest";

import type { SharePayload } from "@/lib/social-share";

import type { SocialShareColors } from "./social-share-colors";
import {
  CRATE_STORY_STYLES,
  drawCrateStoryCard,
  drawWrappedStoryCard,
  resolveCrateStoryStyle,
  STORY_HEIGHT,
  STORY_SAFE_BOTTOM,
  type CrateStoryArtwork,
  type CrateStoryStyle,
} from "./social-share-story-canvas";

interface Recorded {
  texts: { text: string; y: number }[];
  images: number;
}

function fakeContext(): [CanvasRenderingContext2D, Recorded] {
  const recorded: Recorded = { texts: [], images: 0 };
  const state: Record<string, unknown> = { font: "400 10px sans-serif" };
  const fontSize = () => Number(/(\d+)px/.exec(String(state.font))?.[1] ?? 10);
  const methods: Record<string, unknown> = {
    fillText: (text: string, _x: number, y: number) =>
      recorded.texts.push({ text, y }),
    drawImage: () => {
      recorded.images += 1;
    },
    measureText: (text: string) => ({ width: text.length * fontSize() * 0.55 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  };
  const ctx = new Proxy(state, {
    get: (target, key: string) =>
      key in methods
        ? methods[key]
        : key in target
          ? target[key]
          : () => undefined,
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
  return [ctx as unknown as CanvasRenderingContext2D, recorded];
}

const colors = new Proxy({} as SocialShareColors, {
  get: (_target, key) => (key === "accent" ? "#21b4d2" : "#ffffff"),
});

function albums(count: number): CrateStoryArtwork[] {
  return Array.from({ length: count }, (_, index) => ({
    image: { naturalWidth: 600, naturalHeight: 600 } as HTMLImageElement,
    position: index,
    name: `Album ${index + 1}`,
    artistName: `Artist ${index + 1}`,
  }));
}

function payload(style: CrateStoryStyle, ordered: boolean): SharePayload {
  return {
    kind: "crate",
    title: "Best of 2026",
    url: "https://listen.example/share/crate/best-of-2026",
    crateOwnerName: "Diego",
    crateIsOrdered: ordered,
    crateAlbumCount: 10,
    crateTrackCount: 112,
    crateStoryStyle: style,
  };
}

const ranks = Array.from({ length: 10 }, (_, index) =>
  String(index + 1).padStart(2, "0"),
);

describe("crate story styles", () => {
  it.each(CRATE_STORY_STYLES)(
    "%s draws ten ranked covers without the link or ranked pill",
    (style) => {
      const [ctx, recorded] = fakeContext();
      drawCrateStoryCard(ctx, payload(style, true), albums(10), null, colors, {
        kicker: "Ranked",
        cta: "Listen on Crate",
      });

      const texts = recorded.texts.map(({ text }) => text);
      expect(recorded.images).toBe(10);
      expect(ranks.every((rank) => texts.includes(rank))).toBe(true);
      expect(texts.some((text) => text.includes("listen.example"))).toBe(false);
      expect(texts.some((text) => /ranked|listen on crate/i.test(text))).toBe(
        false,
      );
      expect(texts).toContain("Best of 2026");
      expect(
        recorded.texts
          .filter(({ text }) => !ranks.includes(text))
          .every(({ y }) => y <= STORY_HEIGHT - STORY_SAFE_BOTTOM),
      ).toBe(true);
    },
  );

  it.each(CRATE_STORY_STYLES)(
    "%s hides ranks for unordered Crates",
    (style) => {
      const [ctx, recorded] = fakeContext();
      drawCrateStoryCard(ctx, payload(style, false), albums(10), null, colors);

      const texts = recorded.texts.map(({ text }) => text);
      expect(ranks.some((rank) => texts.includes(rank))).toBe(false);
      expect(recorded.images).toBe(10);
    },
  );

  it.each(CRATE_STORY_STYLES)(
    "%s adapts to Crates with few albums",
    (style) => {
      const [ctx, recorded] = fakeContext();
      drawCrateStoryCard(ctx, payload(style, true), albums(3), null, colors);

      expect(recorded.images).toBe(3);
      expect(recorded.texts.map(({ text }) => text)).toContain("Best of 2026");
    },
  );

  it("lists album titles and artists in the chart style", () => {
    const [ctx, recorded] = fakeContext();
    drawCrateStoryCard(ctx, payload("chart", true), albums(10), null, colors);

    const texts = recorded.texts.map(({ text }) => text);
    expect(texts).toContain("Album 10");
    expect(texts).toContain("Artist 10");
  });

  it("fills the space under the bento wall with the album list", () => {
    const [ctx, recorded] = fakeContext();
    drawCrateStoryCard(ctx, payload("bento", true), albums(10), null, colors);

    const texts = recorded.texts.map(({ text }) => text);
    expect(texts).toContain("Album 10");
    expect(texts).toContain("Artist 1");
  });

  it("falls back to the bento wall when no valid style is set", () => {
    expect(resolveCrateStoryStyle({ kind: "crate", title: "x", url: "" })).toBe(
      "bento",
    );
    expect(
      resolveCrateStoryStyle({
        kind: "crate",
        title: "x",
        url: "",
        crateStoryStyle: "spiral" as CrateStoryStyle,
      }),
    ).toBe("bento");
  });
});

describe("wrapped story card", () => {
  const data = {
    kicker: "2026 on Crate",
    headline: "Converge, no doubt about it.",
    coverUrls: ["a", "b", "c", "d", "e"],
    topArtistsLabel: "Top artists",
    topArtists: [
      "Converge",
      "Birds In Row",
      "Black Curse",
      "Dredg",
      "High Vis",
    ],
    topTracksLabel: "Top tracks",
    topTracks: [
      "Love Is Not Enough",
      "Water Wings",
      "Spectral Wound",
      "Bug Eyes",
      "Fever",
    ],
    stats: [
      { value: "41,382", label: "minutes" },
      { value: "metalcore", label: "top genre" },
      { value: "47", label: "Longest streak" },
      { value: "61", label: "New artists" },
      { value: "2009", label: "Music age" },
    ],
    credit: "A selected year by diego.trecedoce",
  };

  it("draws every section inside the story safe area", () => {
    const [ctx, recorded] = fakeContext();
    const image = { naturalWidth: 600, naturalHeight: 600 } as HTMLImageElement;

    drawWrappedStoryCard(
      ctx,
      data,
      [image, image, null, image, image],
      null,
      colors,
    );

    const texts = recorded.texts.map((entry) => entry.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "2026 on Crate",
        "Converge",
        "Love Is Not Enough",
        "41,382",
        "metalcore",
        "47",
        "A selected year by diego.trecedoce",
      ]),
    );
    expect(recorded.images).toBe(4);
    const body = recorded.texts.filter(
      (entry) => !entry.text.startsWith("A selected"),
    );
    expect(Math.max(...body.map((entry) => entry.y))).toBeLessThanOrEqual(
      STORY_HEIGHT - STORY_SAFE_BOTTOM,
    );
  });
});
