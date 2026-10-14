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

describe("scratch buffers", () => {
  const eye: [number, number, number] = [1.2, 0.4, 2.9];

  it("writes the same matrices into a reused Float32Array", () => {
    const projection = new Float32Array(16);
    const view = new Float32Array(16);
    const mvp = new Float32Array(16);

    for (let i = 0; i < 2; i++)
      multiply(
        perspective(0.85, 1.6, 0.04, 50, projection),
        lookAt(eye, [0, 0, 0], view),
        mvp,
      );

    expect(Array.from(projection)).toEqual(
      Array.from(Float32Array.from(perspective(0.85, 1.6, 0.04, 50))),
    );
    expect(Array.from(view)).toEqual(
      Array.from(Float32Array.from(lookAt(eye, [0, 0, 0]))),
    );
    expect(Array.from(mvp)).toEqual(
      Array.from(
        Float32Array.from(multiply(Array.from(projection), Array.from(view))),
      ),
    );
  });

  it("returns the buffer it was given", () => {
    const out = new Float32Array(16);
    expect(perspective(0.85, 1, 0.1, 10, out)).toBe(out);
    expect(lookAt(eye, [0, 0, 0], out)).toBe(out);
    expect(multiply(new Float32Array(16), new Float32Array(16), out)).toBe(out);
  });
});
