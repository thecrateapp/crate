import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RouteSpinner, AuthSpinner } from "./AppFallbacks";

afterEach(() => vi.useRealTimers());
it.each([RouteSpinner, AuthSpinner])(
  "uses the shared delayed indicator for a Listen shell fallback",
  (Fallback) => {
    vi.useFakeTimers();
    const { container, unmount } = render(<Fallback />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(screen.getByRole("status")).toHaveAccessibleName();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  },
);
