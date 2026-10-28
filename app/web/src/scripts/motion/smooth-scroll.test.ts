import { gsap } from "gsap";
import { describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  finePointer: () => true,
  reducedMotion: () => false,
}));
vi.mock("lenis", () => ({
  default: class {
    on() {}
    raf() {}
    destroy() {}
  },
}));

vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
}));

const { initSmoothScroll } = await import("./smooth-scroll");

describe("initSmoothScroll", () => {
  it("disables lag smoothing while active and restores the gsap default", () => {
    const lagSmoothing = vi.spyOn(gsap.ticker, "lagSmoothing");

    const cleanup = initSmoothScroll();
    expect(lagSmoothing).toHaveBeenLastCalledWith(0);

    cleanup();
    expect(lagSmoothing).toHaveBeenLastCalledWith(500, 33);
  });
});
