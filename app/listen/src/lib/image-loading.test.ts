import { describe, expect, it } from "vitest";
import { setImageFetchPriority } from "./image-loading";

describe("setImageFetchPriority", () => {
  it("returns false when fetchPriority is not supported", () => {
    const img = document.createElement("img");
    expect(setImageFetchPriority(img, "high")).toBe(false);
  });

  it("returns true and sets priority when supported", () => {
    const img = document.createElement("img") as HTMLImageElement & {
      fetchPriority: string;
    };
    img.fetchPriority = "auto";
    expect(setImageFetchPriority(img, "high")).toBe(true);
    expect(img.fetchPriority).toBe("high");
  });
});
