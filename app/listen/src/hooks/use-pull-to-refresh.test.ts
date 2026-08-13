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
        touches: [{ clientX: 0, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientX: 4, clientY: 200 }],
      } as unknown as React.TouchEvent);
    });
    expect(result.current.pullDistance).toBeGreaterThan(0);
  });

  it("ignores a horizontally dominant swipe at the top of the page", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.handlers.onTouchStart({
        currentTarget: { scrollTop: 0 },
        touches: [{ clientX: 12, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientX: 180, clientY: 124 }],
      } as unknown as React.TouchEvent);
    });

    expect(result.current.pullDistance).toBe(0);

    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("calls onRefresh when threshold is reached", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.handlers.onTouchStart({
        currentTarget: { scrollTop: 0 },
        touches: [{ clientX: 0, clientY: 0 }],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientX: 2, clientY: 300 }],
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
        touches: [{ clientX: 0, clientY: 0 }],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientX: 0, clientY: 10 }],
      } as unknown as React.TouchEvent);
    });
    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("locks a horizontally dominant gesture even when it later moves down", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.handlers.onTouchStart({
        currentTarget: { scrollTop: 0 },
        touches: [{ clientX: 240, clientY: 100 }],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      result.current.handlers.onTouchMove({
        touches: [{ clientX: 160, clientY: 112 }],
      } as unknown as React.TouchEvent);
      result.current.handlers.onTouchMove({
        touches: [{ clientX: 96, clientY: 228 }],
      } as unknown as React.TouchEvent);
    });
    await act(async () => {
      await result.current.handlers.onTouchEnd();
    });

    expect(result.current.pullDistance).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
