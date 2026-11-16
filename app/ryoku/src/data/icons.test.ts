import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ICONS } from "./icons";

// Vitest runs from app/ryoku; jsdom gives import.meta.url an http scheme.
const publicDir = resolve(process.cwd(), "public");

describe("ICONS", () => {
  it("names every app once", () => {
    expect(ICONS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(ICONS.map((icon) => icon.name)).size).toBe(ICONS.length);
  });

  it("mixes Solar glyphs with brand marks", () => {
    const kinds = new Set(ICONS.map((icon) => icon.kind));
    expect(kinds).toEqual(new Set(["solar", "tabler", "simple-icons"]));
  });

  it("shows Discord and no music-streaming service", () => {
    const names = ICONS.map((icon) => icon.name.toLowerCase());
    expect(names).toContain("discord");
    for (const streaming of [
      "spotify",
      "tidal",
      "apple music",
      "deezer",
      "youtube music",
      "soundcloud",
    ]) {
      expect(names.some((name) => name.includes(streaming))).toBe(false);
      for (const icon of ICONS) expect(icon.file).not.toContain(streaming);
    }
  });

  it("serves every icon as a plain SVG from the site's own folder", () => {
    for (const icon of ICONS) {
      expect(icon.file).toMatch(/^\/icons-showcase\/[A-Za-z.-]+\.svg$/);
      const path = `${publicDir}${icon.file}`;
      expect(existsSync(path), path).toBe(true);
      const svg = readFileSync(path, "utf8");
      expect(svg.startsWith("<svg")).toBe(true);
      // No embedded bitmaps or scripts: only the vector glyphs whose licences allow a copy.
      expect(svg).not.toMatch(/<image|<script|href=/);
    }
  });
});
