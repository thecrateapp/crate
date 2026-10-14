import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  readPyDict,
  readTsNumberArrays,
  repoFile,
} from "../../lib/source-drift";
import { EQ_BANDS, EQ_GAIN_MAX, EQ_PRESETS, MOODS } from "./viz";

describe("viz data copied from the apps", () => {
  it("keeps every EQ preset identical to Listen's equalizer", () => {
    const source = readFileSync(
      repoFile("app/listen/src/lib/equalizer.ts"),
      "utf8",
    );
    const block = source.slice(source.indexOf("export const EQ_PRESETS"));

    expect(EQ_PRESETS).toEqual(
      readTsNumberArrays(block.slice(0, block.indexOf("};"))),
    );
  });

  it("keeps the band labels and gain range of Listen's equalizer", () => {
    const source = readFileSync(
      repoFile("app/listen/src/lib/equalizer.ts"),
      "utf8",
    );
    const labels = [...source.matchAll(/label: "([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect([...EQ_BANDS]).toEqual(labels);
    expect(source).toContain(`EQ_GAIN_MAX = ${EQ_GAIN_MAX};`);
  });

  it("keeps every mood threshold identical to the backend mood presets", () => {
    const source = readFileSync(
      repoFile("app/crate/api/browse_media.py"),
      "utf8",
    );
    const presets = readPyDict(source, "MOOD_PRESETS");

    expect(
      Object.fromEntries(MOODS.map((mood) => [mood.id, mood.filters])),
    ).toEqual(presets);
  });
});
