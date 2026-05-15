import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useIsDesktop } from "./use-breakpoint";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: (
        event: string,
        handler: (e: MediaQueryListEvent) => void,
      ) => {
        listeners.add(handler);
      },
      removeEventListener: (
        event: string,
        handler: (e: MediaQueryListEvent) => void,
      ) => {
        listeners.delete(handler);
      },
      dispatchEvent: vi.fn(),
    })),
  });
  return listeners;
}

describe("useIsDesktop", () => {
  it("returns true when matchMedia matches desktop width", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it("returns false when matchMedia does not match desktop width", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });

  it("updates when media query changes", () => {
    const listeners = mockMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);

    act(() => {
      listeners.forEach((fn) => fn({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it("returns true when tauri runtime is detected", () => {
    mockMatchMedia(false);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });
});
