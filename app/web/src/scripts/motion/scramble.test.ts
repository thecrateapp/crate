import { describe, expect, it } from "vitest";
import { scrambleText } from "./scramble";

describe("scrambleText", () => {
  it("writes the final text immediately when motion is reduced", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { reducedMotion: true });
    expect(span.textContent).toBe("Copied");
  });
});
