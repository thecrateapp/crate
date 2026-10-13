import { describe, expect, it } from "vitest";
import { lookAt, multiply, perspective, project } from "./math";

describe("project", () => {
  it("maps the look-at target to the centre of the viewport", () => {
    const mvp = multiply(
      perspective(0.85, 1440 / 900, 0.04, 50),
      lookAt([0, 0, 3], [0, 0, 0]),
    );
    const s = project(mvp, [0, 0, 0], 1440, 900);
    expect(s.x).toBeCloseTo(720, 3);
    expect(s.y).toBeCloseTo(450, 3);
    expect(s.w).toBeGreaterThan(0);
  });
});
