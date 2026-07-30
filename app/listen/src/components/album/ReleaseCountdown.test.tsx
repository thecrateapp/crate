import { screen } from "@testing-library/react";
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

  it("centers each visual separator between the value and label blocks", () => {
    renderWithListenProviders(<ReleaseCountdown releaseDate="2026-08-02" />);

    const separators = screen.getAllByTestId("release-countdown-separator");

    expect(separators).toHaveLength(3);
    for (const separator of separators) {
      expect(separator).toHaveAttribute("aria-hidden", "true");
      expect(separator).toHaveClass("self-center");
    }
  });

  it("uses an opaque non-glass surface from the desktop breakpoint", () => {
    renderWithListenProviders(<ReleaseCountdown releaseDate="2026-08-02" />);

    expect(screen.getByTestId("release-countdown")).toHaveClass(
      "sm:bg-[#101419]/88",
      "sm:backdrop-blur-none",
      "sm:backdrop-saturate-100",
    );
  });

  it("adds a bright mobile glass layer against the dark hero overlay", () => {
    renderWithListenProviders(<ReleaseCountdown releaseDate="2026-08-02" />);

    expect(screen.getByTestId("release-countdown")).toHaveClass(
      "bg-[#0b1520]/45",
      "backdrop-blur-2xl",
      "backdrop-saturate-150",
      "border-white/20",
    );
    expect(screen.getByTestId("release-countdown-glass-sheen")).toHaveClass(
      "sm:hidden",
    );
  });

  it("does not render the cyan top rule", () => {
    renderWithListenProviders(<ReleaseCountdown releaseDate="2026-08-02" />);

    const countdown = screen.getByTestId("release-countdown");
    const hasCyanTopRule = Array.from(countdown.querySelectorAll("*")).some(
      (element) => element.classList.contains("bg-primary/90"),
    );

    expect(hasCyanTopRule).toBe(false);
  });
});
