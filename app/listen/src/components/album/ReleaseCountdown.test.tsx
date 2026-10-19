import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ReleaseCountdown } from "./ReleaseCountdown";

describe("ReleaseCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T10:15:30.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates its clock and disappears at the real release time", () => {
    vi.setSystemTime(new Date("2026-08-01T23:59:58"));
    renderWithListenProviders(<ReleaseCountdown releaseDate="2026-08-02" />);
    expect(
      screen.getByTestId("release-countdown").querySelectorAll("dd"),
    ).toHaveLength(4);
    expect(screen.getByText("02")).toBeVisible();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByTestId("release-countdown")).not.toBeInTheDocument();
  });
  it("uses the same solid surface on mobile and desktop", () => {
    renderWithListenProviders(<ReleaseCountdown releaseDate="2026-08-02" />);
    const countdown = screen.getByTestId("release-countdown");
    expect(countdown).toHaveClass("bg-surface-container");
    expect(countdown).not.toHaveClass(
      "backdrop-blur-2xl",
      "backdrop-saturate-150",
    );
    expect(
      screen.queryByTestId("release-countdown-glass-sheen"),
    ).not.toBeInTheDocument();
    expect(countdown.querySelectorAll("dd .font-display")).toHaveLength(4);
  });
  it("hides invalid and already released dates", () => {
    const { rerender } = renderWithListenProviders(
      <ReleaseCountdown releaseDate="2026-02-31" />,
    );
    expect(screen.queryByTestId("release-countdown")).not.toBeInTheDocument();
    rerender(<ReleaseCountdown releaseDate="2026-07-29" />);
    expect(screen.queryByTestId("release-countdown")).not.toBeInTheDocument();
  });
});
