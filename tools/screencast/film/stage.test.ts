import { describe, expect, it } from "vitest";
import { withoutEntries } from "./stage";

const unknown = (entry: Record<string, unknown>) =>
  entry.artist_name === "Unknown Artist";

describe("withoutEntries", () => {
  it.each([
    {
      name: "a top-level list",
      input: [{ artist_name: "BRAT" }, { artist_name: "Unknown Artist" }],
      output: [{ artist_name: "BRAT" }],
    },
    {
      name: "a list inside a page",
      input: {
        items: [{ artist_name: "Unknown Artist" }, { artist_name: "Samiam" }],
        total: 2,
      },
      output: { items: [{ artist_name: "Samiam" }], total: 2 },
    },
    {
      name: "nested lists",
      input: { groups: [{ artists: [{ artist_name: "Unknown Artist" }] }] },
      output: { groups: [{ artists: [] }] },
    },
    { name: "scalars", input: "Unknown Artist", output: "Unknown Artist" },
  ])("drops matching entries from $name", ({ input, output }) => {
    expect(withoutEntries(input, unknown)).toEqual(output);
  });
});
