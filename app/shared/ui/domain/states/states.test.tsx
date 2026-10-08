import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  CRATE_LOADER_DEFAULT_PHRASES,
  CrateLoader,
  LoadingState,
} from "./index";

describe("LoadingState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a section spinner with an accessible status label", () => {
    render(<LoadingState label="Loading albums" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-variant", "section");
    expect(status).toHaveTextContent("Loading albums");
    expect(status.querySelector("svg")).toHaveClass("animate-spin");
  });

  it.each(["page", "screen"] as const)(
    "delegates the %s variant to the Crate loader",
    (variant) => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      render(<LoadingState variant={variant} label="Loading artist" />);

      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("data-variant", variant);
      expect(status).toHaveTextContent("Loading artist");
      expect(status).toHaveTextContent(CRATE_LOADER_DEFAULT_PHRASES[0]);
    },
  );
});

describe("CrateLoader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the play glow language with the logo effects off", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = render(<CrateLoader />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(container.querySelector("svg")).toHaveAttribute(
      "data-crate-logo-effects",
      "off",
    );
    expect(container.innerHTML).toContain("animate-crate-play-aura-pulse");
    expect(container.innerHTML).toContain("animate-crate-play-rim-pulse");
    expect(container.innerHTML).toContain("animate-crate-play-core-pulse");
  });

  it("renders three hidden animated dots", () => {
    render(<CrateLoader />);

    const dots = screen.getAllByTestId("crate-loader-dot");
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("uses translated phrases and keeps the phrase stable across renders", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const phrases = ["Alimentando tu alma", "Afinando la sala"];
    const { rerender } = render(<CrateLoader phrases={phrases} />);

    expect(screen.getByRole("status")).toHaveTextContent("Afinando la sala");
    randomSpy.mockReturnValue(0);
    rerender(<CrateLoader phrases={phrases} />);
    expect(screen.getByRole("status")).toHaveTextContent("Afinando la sala");
  });
});
