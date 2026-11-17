import { describe, expect, it } from "vitest";
import { TOUR } from "./tour";

describe("TOUR", () => {
  it("numbers the five chapters in order", () => {
    expect(TOUR.map((chapter) => [chapter.number, chapter.id])).toEqual([
      ["01", "music"],
      ["02", "bar"],
      ["03", "panels"],
      ["04", "rashin"],
      ["05", "desktop"],
    ]);
  });

  it("serves every poster and clip from the media mount, never from the image", () => {
    for (const chapter of TOUR) {
      for (const [path, extension] of [
        [chapter.poster, "jpg"],
        [chapter.webm, "webm"],
        [chapter.mp4, "mp4"],
      ] as const) {
        expect(path).toBe(
          `/media/tour/${chapter.id}.${extension}?v=2026-11-16`,
        );
      }
    }
  });
});
