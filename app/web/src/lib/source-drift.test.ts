import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  readPyConstants,
  readPyDict,
  readPyTuples,
  readTsNumberArrays,
  repoFile,
} from "./source-drift";

describe("repoFile", () => {
  it("resolves paths from the repository root", () => {
    expect(existsSync(repoFile("app/web/package.json"))).toBe(true);
  });
});

describe("readTsNumberArrays", () => {
  it("reads named number arrays and ignores comments", () => {
    const source = `{
      flat: [0, 0, 0],
      // tuned for blast beats
      black_metal: [-1, 3, 4.5],
    }`;

    expect(readTsNumberArrays(source)).toEqual({
      flat: [0, 0, 0],
      black_metal: [-1, 3, 4.5],
    });
  });
});

describe("readPyDict", () => {
  it("parses a module-level dict literal with nested dicts, booleans and trailing commas", () => {
    const source = `
OTHER = 1
MOOD_PRESETS = {
    "chill": {"energy_max": 0.4, "valence_min": 0.3},  # calm
    "intense": {"energy_min": 0.8, "strict": True, "note": None},
}

def after(): pass
`;

    expect(readPyDict(source, "MOOD_PRESETS")).toEqual({
      chill: { energy_max: 0.4, valence_min: 0.3 },
      intense: { energy_min: 0.8, strict: true, note: null },
    });
  });

  it("throws when the name is missing", () => {
    expect(() => readPyDict("A = {}\n", "B")).toThrow(/B/);
  });
});

describe("readPyConstants", () => {
  it("reads numeric and string module constants by prefix", () => {
    const source = `DEFAULT_LOAD_RATIO = 0.85\nDEFAULT_WINDOW = "02:00"\nOTHER = 3\n`;

    expect(readPyConstants(source, "DEFAULT_")).toEqual({
      DEFAULT_LOAD_RATIO: 0.85,
      DEFAULT_WINDOW: "02:00",
    });
  });
});

describe("readPyTuples", () => {
  it("reads named float tuples", () => {
    const source = `_EQ_ROCK = (4.0, 3.0, -1.0)\n_EQ_POP = (-1.0, 2.0)\n`;

    expect(readPyTuples(source, "_EQ_")).toEqual({
      _EQ_ROCK: [4, 3, -1],
      _EQ_POP: [-1, 2],
    });
  });
});
