import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePullToRefresh } from "./use-pull-to-refresh";

describe("usePullToRefresh", () => {
  it("returns initial state", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    expect(result.current.pullDistance).toBe(0);
    expect(result.current.refreshing).toBe(false);
  });

  it("sets pullDistance on touch move", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    act(() => {
      result.current.handlers.onTouchStart({
        currentTarget: { scrollTop: 0 },
        touches: [{ clientY: 100 }],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientY: 200 }],
      } as unknown as React.TouchEvent);
    });
    expect(result.current.pullDistance).toBeGreaterThan(0);
  });

  it("calls onRefresh when threshold is reached", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.handlers.onTouchStart({
        currentTarget: { scrollTop: 0 },
        touches: [{ clientY: 0 }],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientY: 300 }],
      } as unknown as React.TouchEvent);
    });
    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not call onRefresh when threshold is not reached", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.handlers.onTouchStart({
        currentTarget: { scrollTop: 0 },
        touches: [{ clientY: 0 }],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientY: 10 }],
      } as unknown as React.TouchEvent);
    });
    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
