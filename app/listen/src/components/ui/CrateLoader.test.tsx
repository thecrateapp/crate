import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CRATE_LOADING_PHRASES, CrateLoader } from "./CrateLoader";

describe("CrateLoader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the Crate logo loader with the play glow language", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = render(<CrateLoader />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Music.");
    expect(screen.getByRole("status")).toHaveTextContent("Feeding your soul");
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/icons/logo.svg",
    );
    expect(container.innerHTML).toContain("animate-crate-play-aura-pulse");
    expect(container.innerHTML).toContain("animate-crate-play-rim-pulse");
    expect(container.innerHTML).toContain("animate-crate-play-core-pulse");
  });

  it("renders all proposed loading phrases in the rotation", () => {
    expect(CRATE_LOADING_PHRASES).toEqual([
      "Feeding your soul",
      "Loading Crate",
      "Warming the amps",
      "Spinning up the collection",
      "Cueing the next obsession",
      "Tuning the room",
      "Checking the liner notes",
      "Dusting off the crates",
      "Finding something loud",
      "Syncing the signal",
    ]);
  });

  it("renders animated ellipsis dots separately from the phrase", () => {
    render(<CrateLoader />);

    const dots = screen.getAllByTestId("crate-loader-dot");
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(dot).toHaveClass("animate-crate-loader-dot-bounce");
    }
  });

  it("keeps the selected phrase stable for one mounted loader", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { rerender } = render(<CrateLoader />);

    expect(screen.getByRole("status")).toHaveTextContent("Syncing the signal");
    randomSpy.mockReturnValue(0);
    rerender(<CrateLoader />);

    expect(screen.getByRole("status")).toHaveTextContent("Syncing the signal");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Feeding your soul",
    );
  });

  it("supports custom loading labels for screen readers", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<CrateLoader label="Loading artist." />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading artist.");
    expect(screen.getByRole("status")).toHaveTextContent("Feeding your soul");
  });
});
