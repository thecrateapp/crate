import { describe, expect, it, vi } from "vitest";
import {
  canUseHoverPointer,
  subscribeHoverPointer,
  HOVER_POINTER_MEDIA_QUERY,
} from "./input-capabilities";

describe("canUseHoverPointer", () => {
  it("returns true when hover media query matches", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({ matches: true })),
    });
    expect(canUseHoverPointer()).toBe(true);
  });

  it("returns false when hover media query does not match", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({ matches: false })),
    });
    expect(canUseHoverPointer()).toBe(false);
  });
});

describe("subscribeHoverPointer", () => {
  it("calls callback with current state and returns unsubscribe", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener,
        removeEventListener,
      })),
    });

    const callback = vi.fn();
    const unsubscribe = subscribeHoverPointer(callback);
    expect(callback).toHaveBeenCalledWith(true);
    unsubscribe();
    expect(removeEventListener).toHaveBeenCalled();
  });
});

describe("HOVER_POINTER_MEDIA_QUERY", () => {
  it("is the expected query string", () => {
    expect(HOVER_POINTER_MEDIA_QUERY).toBe(
      "(hover: hover) and (pointer: fine)",
    );
  });
});
