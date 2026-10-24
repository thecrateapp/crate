import { describe, expect, it } from "vitest";
import { validatePlaylistCreation } from "./playlist-creation-validation";

const genre = {
  field: "genre",
  op: "contains",
  value: "ambient",
  rangeMin: "",
  rangeMax: "",
};
describe("Playlist creation validation", () => {
  it.each([
    { patch: { limit: "0" }, error: "limit" },
    { patch: { limit: "" }, error: "limit" },
    { patch: { limit: "501" }, error: "limit" },
    { patch: { limit: "1.5" }, error: "limit" },
    { patch: { featuredRank: "1.5" }, error: "featuredRank" },
  ])(
    "rejects invalid numeric draft $patch before creating",
    ({ patch, error }) => {
      const result = validatePlaylistCreation({
        rules: [genre],
        limit: "50",
        featuredRank: "",
        ...patch,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[error as "limit" | "featuredRank"]).toBeTruthy();
    },
  );
  it.each([
    { field: "bpm", value: "abc" },
    { field: "bpm", value: "Infinity" },
    { field: "bpm", value: "0x10" },
    { field: "year", value: "24" },
  ])(
    "identifies the invalid $field rule without serializing it as null",
    ({ field, value }) => {
      const result = validatePlaylistCreation({
        rules: [{ ...genre, field, op: "gte", value }],
        limit: "50",
        featuredRank: "",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.byRule[0]).toBeTruthy();
    },
  );
  it("caps the completed rule count at twelve", () => {
    const result = validatePlaylistCreation({
      rules: Array.from({ length: 13 }, () => ({ ...genre })),
      limit: "50",
      featuredRank: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.rules).toBe("Use no more than 12 rules.");
  });
  it("preserves valid numeric and four-digit year types including between bounds", () => {
    const result = validatePlaylistCreation({
      rules: [
        { ...genre, field: "bpm", op: "gte", value: "120.5" },
        {
          ...genre,
          field: "year",
          op: "between",
          value: "",
          rangeMin: "2000",
          rangeMax: "2020",
        },
      ],
      limit: "500",
      featuredRank: "2",
    });
    expect(result).toMatchObject({
      valid: true,
      limit: 500,
      featuredRank: 2,
      rules: [
        { field: "bpm", op: "gte", value: 120.5 },
        { field: "year", op: "between", value: ["2000", "2020"] },
      ],
    });
  });
});
