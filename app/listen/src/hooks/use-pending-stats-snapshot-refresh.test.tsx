import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePendingStatsSnapshotRefresh } from "@/hooks/use-pending-stats-snapshot-refresh";

describe("usePendingStatsSnapshotRefresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("revalidates while a stats snapshot is pending and stops once it is ready", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const { rerender } = renderHook(
      ({ pending }) => usePendingStatsSnapshotRefresh(pending, refetch),
      { initialProps: { pending: true } },
    );

    act(() => {
      vi.advanceTimersByTime(1_499);
    });
    expect(refetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender({ pending: false });
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
