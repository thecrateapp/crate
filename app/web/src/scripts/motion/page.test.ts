import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountOnPage } from "./page";

const pageLoad = () => document.dispatchEvent(new Event("astro:page-load"));
const beforeSwap = () => document.dispatchEvent(new Event("astro:before-swap"));

beforeEach(() => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
});

afterEach(() => {
  beforeSwap();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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

  it("mounts when registered after Astro's initial page-load event", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    document.body.innerHTML = '<div class="late-page"></div>';
    pageLoad();
    const init = vi.fn(() => () => {});
    mountOnPage(".late-page", init);
    expect(init).toHaveBeenCalledTimes(1);
    pageLoad();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("mounts at DOM readiness without waiting for Astro or window load", () => {
    document.body.innerHTML = '<div class="dom-ready-page"></div>';
    const init = vi.fn(() => () => {});
    mountOnPage(".dom-ready-page", init);
    expect(init).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(init).toHaveBeenCalledTimes(1);
    pageLoad();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("cleans up before a swap and mounts one controller on the next page", () => {
    const cleanup = vi.fn();
    const init = vi.fn(() => cleanup);
    document.body.innerHTML = '<div class="swap-test"></div>';
    mountOnPage(".swap-test", init);
    pageLoad();
    pageLoad();
    expect(init).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    beforeSwap();
    expect(cleanup).toHaveBeenCalledTimes(1);
    beforeSwap();
    expect(cleanup).toHaveBeenCalledTimes(1);
    pageLoad();
    expect(init).toHaveBeenCalledTimes(2);
  });
});
