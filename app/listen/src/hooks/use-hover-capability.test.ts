import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHoverCapability } from "./use-hover-capability";

describe("useHoverCapability", () => {
  it("returns true when hover media query matches", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const { result } = renderHook(() => useHoverCapability());
    expect(result.current).toBe(true);
  });

  it("returns false when hover media query does not match", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const { result } = renderHook(() => useHoverCapability());
    expect(result.current).toBe(false);
  });
});
