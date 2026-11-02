import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STACK_MAP_VIEW_STORAGE_KEY,
  readStackMapView,
  useStackMapView,
} from "./stack-map-view-preference";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("stack map view preference", () => {
  it("defaults to 2D and ignores unknown stored values", () => {
    expect(readStackMapView()).toBe("2d");
    window.localStorage.setItem(STACK_MAP_VIEW_STORAGE_KEY, "orbit");
    expect(readStackMapView()).toBe("2d");
  });

  it("persists the chosen view", () => {
    const { result } = renderHook(() => useStackMapView());
    act(() => result.current[1]("3d"));
    expect(result.current[0]).toBe("3d");
    expect(window.localStorage.getItem(STACK_MAP_VIEW_STORAGE_KEY)).toBe("3d");
    expect(renderHook(() => useStackMapView()).result.current[0]).toBe("3d");
  });

  it("falls back to 2D when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useStackMapView());
    expect(result.current[0]).toBe("2d");
    act(() => result.current[1]("3d"));
    expect(result.current[0]).toBe("3d");
  });
});
