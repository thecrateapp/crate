import { describe, expect, it } from "vitest";
import {
  GALLERY,
  galleryErrors,
  galleryTakes,
  type GalleryShot,
} from "./gallery";

describe("gallery", () => {
  it("lists every screen once with a title and a descriptive alt", () => {
    expect(galleryErrors(GALLERY)).toEqual([]);
  });

  it("covers both apps", () => {
    expect(
      GALLERY.filter((entry) => entry.app === "listen").length,
    ).toBeGreaterThanOrEqual(12);
    expect(
      GALLERY.filter((entry) => entry.app === "admin").length,
    ).toBeGreaterThanOrEqual(12);
  });

  it("reports duplicates and weak alt text", () => {
    const entry: GalleryShot = {
      id: "home",
      app: "listen",
      title: "Home",
      caption: "Home",
      alt: "Home",
      desktop: { take: "home-hero", at: 0 },
      mobile: { take: "home-hero", at: 0 },
    };

    expect(galleryErrors([entry, entry])).toEqual([
      "listen/home needs a caption",
      "listen/home needs a descriptive alt text",
      "listen/home is listed twice",
      "listen/home needs a caption",
      "listen/home needs a descriptive alt text",
    ]);
  });

  it("names the desktop and mobile takes each screen needs", () => {
    const takes = galleryTakes(GALLERY);

    expect(takes).toContain("listen/crates/desktop");
    expect(takes).toContain("listen/crates/mobile");
    expect(takes).toContain("admin/imports/mobile");
  });
});
