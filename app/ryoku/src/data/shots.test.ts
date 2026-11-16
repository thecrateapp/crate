import { describe, expect, it } from "vitest";
import { SHOTS } from "./shots";

describe("SHOTS", () => {
  it("opens on the whole desktop and names every shot once", () => {
    expect(SHOTS[0]?.title).toBe("The Crate desktop");
    expect(new Set(SHOTS.map((shot) => shot.title)).size).toBe(SHOTS.length);
  });

  it("serves every image from the media mount, never from the image", () => {
    for (const shot of SHOTS) {
      for (const path of [
        shot.src,
        shot.srcSmall,
        shot.portrait,
        shot.portraitSmall,
      ]) {
        expect(path).toMatch(
          /^\/media\/shots\/[a-z]+(-1280|-portrait|-portrait-1080)?\.webp\?v=\d{4}-\d{2}-\d{2}$/,
        );
      }
    }
  });

  it("describes every shot for screen readers", () => {
    for (const shot of SHOTS) expect(shot.alt.length).toBeGreaterThan(10);
  });
});
