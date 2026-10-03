import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canUseHoverPointer,
  subscribeHoverPointer,
  useHoverCapability,
} from "./use-hover-capability";

const originalMatchMedia = window.matchMedia;

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    addEventListener: vi.fn((_: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_: string, listener: () => void) => {
      listeners.delete(listener);
    }),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn(() => query),
  });
  return {
    query,
    emit(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("useHoverCapability", () => {
  it("returns true when the hover media query matches", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useHoverCapability());
    expect(result.current).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(hover: hover) and (pointer: fine)",
    );
  });

  it("returns false when the hover media query does not match", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useHoverCapability());
    expect(result.current).toBe(false);
  });

  it("updates when the media query changes and unsubscribes on unmount", () => {
    const media = mockMatchMedia(false);
    const { result, unmount } = renderHook(() => useHoverCapability());
    act(() => media.emit(true));
    expect(result.current).toBe(true);
    unmount();
    expect(media.query.removeEventListener).toHaveBeenCalled();
  });

  it("reports false without matchMedia", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    expect(canUseHoverPointer()).toBe(false);
    const callback = vi.fn();
    subscribeHoverPointer(callback)();
    expect(callback).toHaveBeenCalledWith(false);
  });
});
