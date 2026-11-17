import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountBackdrop } from "./backdrop";

let reduce = false;
let changeListener: (() => void) | undefined;
let intersect: ((entries: { isIntersecting: boolean }[]) => void) | undefined;

function page() {
  document.body.innerHTML = `<div data-backdrop><video preload="none"></video></div>`;
  const video = document.querySelector("video")!;
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  Object.assign(video, { play, pause });
  return { video, play, pause };
}

beforeEach(() => {
  reduce = false;
  changeListener = undefined;
  intersect = undefined;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return reduce;
      },
      addEventListener: (_: string, fn: () => void) => (changeListener = fn),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(fn: typeof intersect) {
        intersect = fn;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("mountBackdrop", () => {
  it("plays the loop and starts loading it once mounted", () => {
    const { video, play } = page();
    mountBackdrop();
    expect(play).toHaveBeenCalled();
    expect(video.preload).toBe("auto");
  });

  it("keeps the poster when the viewer asks for reduced motion", () => {
    reduce = true;
    const { video, play } = page();
    mountBackdrop();
    expect(play).not.toHaveBeenCalled();
    expect(video.preload).toBe("none");
  });

  it("pauses when reduced motion is switched on", () => {
    const { pause } = page();
    mountBackdrop();
    reduce = true;
    changeListener?.();
    expect(pause).toHaveBeenCalled();
  });

  it("pauses off screen and resumes on screen", () => {
    const { play, pause } = page();
    mountBackdrop();
    play.mockClear();
    intersect?.([{ isIntersecting: false }]);
    expect(pause).toHaveBeenCalled();
    intersect?.([{ isIntersecting: true }]);
    expect(play).toHaveBeenCalled();
  });

  it("pauses while the tab is hidden and resumes when it shows", () => {
    const { play, pause } = page();
    mountBackdrop();
    play.mockClear();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pause).toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(play).toHaveBeenCalled();
  });

  it("does nothing without a backdrop", () => {
    expect(() => mountBackdrop()()).not.toThrow();
  });
});
