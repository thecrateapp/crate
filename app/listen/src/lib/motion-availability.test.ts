import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "./motion-availability";

function setVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  setVisibilityState("visible");
  vi.unstubAllGlobals();
});

describe("motion availability", () => {
  it("blocks motion while the document is hidden", () => {
    setVisibilityState("hidden");

    expect(isMotionBlocked()).toBe(true);
  });

  it("blocks motion when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    expect(isMotionBlocked()).toBe(true);
  });

  it("notifies on visibility and reduced-motion changes", () => {
    const onChange = vi.fn();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener,
      removeEventListener,
    }));

    const unsubscribe = subscribeToMotionAvailability(onChange);
    document.dispatchEvent(new Event("visibilitychange"));
    const mediaChange = addEventListener.mock.calls[0]?.[1];
    mediaChange?.(new Event("change"));

    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("change", mediaChange);
  });
});
