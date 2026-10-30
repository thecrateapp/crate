import { afterEach, describe, expect, it, vi } from "vitest";
import { backdropShade, initBackdrop } from "./backdrop";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("backdropShade", () => {
  it("keeps the photo at full strength through the hero and dims it below", () => {
    expect(backdropShade(0, 900)).toBe(0);
    expect(backdropShade(540, 900)).toBe(0);
    expect(backdropShade(990, 900)).toBeCloseTo(0.5);
    expect(backdropShade(5000, 900)).toBe(1);
  });
});

describe("initBackdrop", () => {
  it("does nothing on pages with the dim backdrop", () => {
    document.body.innerHTML = '<div class="backdrop is-dim"></div>';
    const listen = vi.spyOn(window, "addEventListener");

    initBackdrop()();

    expect(listen).not.toHaveBeenCalledWith(
      "scroll",
      expect.anything(),
      expect.anything(),
    );
  });

  it("shades the full backdrop from the current scroll and stops listening on cleanup", () => {
    document.body.innerHTML = '<div class="backdrop is-full"></div>';
    vi.stubGlobal("innerHeight", 1000);
    vi.stubGlobal("scrollY", 1100);
    const remove = vi.spyOn(window, "removeEventListener");

    const cleanup = initBackdrop();
    const backdrop = document.querySelector<HTMLElement>(".backdrop")!;
    expect(backdrop.style.getPropertyValue("--shade")).toBe("0.500");

    cleanup();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
