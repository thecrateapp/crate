import { describe, expect, it } from "vitest";

import { BLUR_FRAG } from "./shaders";

describe("visualizer blur shader", () => {
  it("combines each blur axis using five linear texture samples", () => {
    expect(BLUR_FRAG.match(/texture\(scene,/g)).toHaveLength(5);
    expect(BLUR_FRAG).toContain("u_Horizontal");
  });
});
