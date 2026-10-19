import { describe, expect, it } from "vitest";

import { humanizeKey } from "./humanize";

describe("humanizeKey", () => {
  it.each([
    ["artist_name", "Artist name"],
    ["maxOutputTokens", "Max output tokens"],
    ["id", "Id"],
    ["already Spaced", "Already spaced"],
  ])("turns %s into %s", (key, expected) => {
    expect(humanizeKey(key)).toBe(expected);
  });
});
