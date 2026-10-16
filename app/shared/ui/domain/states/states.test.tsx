import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { CrateLoader, LoadingState } from "./index";

describe("LoadingState", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("names section loading and reserves visible static readings without a spinner", () => {
    const { container } = render(<LoadingState label="Loading albums" />);
    expect(
      screen.getByRole("status", { name: "Loading albums" }),
    ).not.toHaveAttribute("aria-busy", "true");
    expect(
      container.querySelector('[data-slot="skeleton-table"]'),
    ).toBeInTheDocument();
    expect(container.textContent).toContain("—");
    expect(
      container.querySelector(".animate-spin, .animate-pulse, svg"),
    ).toBeNull();
  });

  it("accepts the caller's final layout while hiding decorative readings from assistive tech", () => {
    render(
      <LoadingState label="Loading tracks">
        <div data-testid="final-layout">— / —</div>
      </LoadingState>,
    );
    expect(screen.getByTestId("final-layout")).toBeInTheDocument();
    expect(
      screen.getByTestId("final-layout").closest('[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it.each(["route", "page", "screen"] as const)(
    "delays the %s indicator by 200ms without reserving fake progress",
    (variant) => {
      vi.useFakeTimers();
      render(
        <LoadingState
          variant={variant}
          label="Loading artist"
          phrases={["Do not cycle"]}
        />,
      );
      expect(screen.queryByText("Loading artist")).toBeNull();
      act(() => vi.advanceTimersByTime(199));
      expect(screen.queryByRole("progressbar")).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(
        screen.getByRole("status", { name: "Loading artist" }),
      ).toHaveAttribute("data-variant", variant);
      expect(
        screen.getByRole("progressbar", { name: "Loading artist" }),
      ).not.toHaveAttribute("aria-valuenow");
      expect(screen.queryByText("Do not cycle")).toBeNull();
    },
  );

  it("does not defer the route announcement behind a permanent busy flag", () => {
    vi.useFakeTimers();
    render(<LoadingState variant="route" label="Loading tracks" />);
    act(() => vi.advanceTimersByTime(200));
    expect(
      screen.getByRole("status", { name: "Loading tracks" }),
    ).not.toHaveAttribute("aria-busy", "true");
  });

  it("cancels a route indicator that resolves before its delay", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <LoadingState variant="route" label="Loading" />,
    );
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
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
