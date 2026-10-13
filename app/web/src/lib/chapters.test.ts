import { describe, expect, it } from "vitest";
import { chapterId } from "./chapters";

describe("chapterId", () => {
  it("prefixes the zero-padded index to a slug of the title", () => {
    expect(chapterId(2, "Radio")).toBe("02-radio");
  });

  it("collapses punctuation and spaces into single dashes", () => {
    expect(chapterId(9, "Decks & DJs")).toBe("09-decks-djs");
  });

  it("keeps two-digit indexes as they are", () => {
    expect(chapterId(12, "  Two Redises, on purpose. ")).toBe(
      "12-two-redises-on-purpose",
    );
  });
});
