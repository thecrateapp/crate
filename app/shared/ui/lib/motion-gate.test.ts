import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isMotionBlocked,
  isWindowHidden,
  setWindowHidden,
  subscribeToMotionAvailability,
  useMotionAllowed,
} from "./motion-gate";

function mockReducedMotion(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  } as unknown as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(query);
  return {
    set(next: boolean) {
      (query as { matches: boolean }).matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function mockVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
}

describe("motion-gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset.crateMotion;
    delete document.documentElement.dataset.crateWindow;
  });

  it("allows motion when nothing blocks it", () => {
    mockReducedMotion(false);

    expect(isMotionBlocked()).toBe(false);
  });

  it("blocks motion when the OS asks for reduced motion", () => {
    mockReducedMotion(true);

    expect(isMotionBlocked()).toBe(true);
  });

  it("blocks motion when the app sets data-crate-motion to reduced", () => {
    mockReducedMotion(false);
    document.documentElement.dataset.crateMotion = "reduced";

    expect(isMotionBlocked()).toBe(true);
  });

  it("blocks motion while the document is hidden", () => {
    mockReducedMotion(false);
    mockVisibility("hidden");

    expect(isMotionBlocked()).toBe(true);
  });

  it("blocks motion while a native shell marks the window hidden", () => {
    mockReducedMotion(false);
    mockVisibility("visible");

    setWindowHidden(true);
    expect(document.documentElement.dataset.crateWindow).toBe("hidden");
    expect(isWindowHidden()).toBe(true);
    expect(isMotionBlocked()).toBe(true);

    setWindowHidden(false);
    expect(document.documentElement.dataset.crateWindow).toBeUndefined();
    expect(isWindowHidden()).toBe(false);
    expect(isMotionBlocked()).toBe(false);
  });

  it("leaves web motion alone when no shell reports window activity", () => {
    mockReducedMotion(false);
    mockVisibility("visible");

    expect(document.documentElement.hasAttribute("data-crate-window")).toBe(
      false,
    );
    expect(isMotionBlocked()).toBe(false);
  });

  it("re-renders useMotionAllowed when the window is hidden and shown", async () => {
    mockReducedMotion(false);
    const { result } = renderHook(() => useMotionAllowed());
    expect(result.current).toBe(true);

    await act(async () => {
      setWindowHidden(true);
      await Promise.resolve();
    });
    expect(result.current).toBe(false);

    await act(async () => {
      setWindowHidden(false);
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });

  it("survives a missing matchMedia", () => {
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      expect(isMotionBlocked()).toBe(false);
      const unsubscribe = subscribeToMotionAvailability(() => undefined);
      unsubscribe();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it("re-renders useMotionAllowed when the media query changes", () => {
    const media = mockReducedMotion(false);
    const { result } = renderHook(() => useMotionAllowed());

    expect(result.current).toBe(true);
    act(() => media.set(true));
    expect(result.current).toBe(false);
  });

  it("notifies subscribers when data-crate-motion changes", async () => {
    mockReducedMotion(false);
    const onChange = vi.fn();
    const unsubscribe = subscribeToMotionAvailability(onChange);

    document.documentElement.dataset.crateMotion = "reduced";
    await Promise.resolve();

    expect(onChange).toHaveBeenCalled();
    unsubscribe();
  });
});
