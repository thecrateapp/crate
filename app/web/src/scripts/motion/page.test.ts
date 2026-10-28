import { afterEach, describe, expect, it, vi } from "vitest";
import { mountOnPage } from "./page";

const pageLoad = () => document.dispatchEvent(new Event("astro:page-load"));
const beforeSwap = () => document.dispatchEvent(new Event("astro:before-swap"));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountOnPage", () => {
  it("runs init only on pages that contain the selector", () => {
    const init = vi.fn(() => () => {});
    mountOnPage(".only-here", init);
    pageLoad();
    expect(init).not.toHaveBeenCalled();
    document.body.innerHTML = '<div class="only-here"></div>';
    pageLoad();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("cleans up before the next swap and before re-initialising", () => {
    const cleanup = vi.fn();
    document.body.innerHTML = '<div class="swap-test"></div>';
    mountOnPage(".swap-test", () => cleanup);
    pageLoad();
    pageLoad();
    expect(cleanup).toHaveBeenCalledTimes(1);
    beforeSwap();
    expect(cleanup).toHaveBeenCalledTimes(2);
    beforeSwap();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
