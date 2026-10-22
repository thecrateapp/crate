import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProgressHairline } from "./ProgressHairline";

let intersection: IntersectionObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
let setReducedMotion: (reduced: boolean) => void;
let visibility: DocumentVisibilityState;

function intersect(isIntersecting: boolean) {
  act(() => {
    intersection(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

describe("ProgressHairline", () => {
  beforeEach(() => {
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    const listeners = new Set<() => void>();
    const query = {
      matches: false,
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
    } as unknown as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(query);
    setReducedMotion = (reduced) => {
      (query as { matches: boolean }).matches = reduced;
      listeners.forEach((listener) => listener());
    };
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersection = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    observe.mockClear();
    disconnect.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.crateMotion;
  });

  it("exposes named numeric progress and updates its fill without changing the range", () => {
    const { rerender } = render(
      <ProgressHairline
        label="Library scan"
        value={0.25}
        valueText="1 of 4 artists"
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Library scan" });
    const fill = bar.querySelector(
      ".crate-progress-hairline-fill",
    ) as HTMLElement;
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute("aria-valuetext", "1 of 4 artists");
    expect(bar).not.toHaveAttribute("data-thickness");
    expect(fill.style.getPropertyValue("--p")).toBe("0.25");

    rerender(
      <ProgressHairline
        label="Library scan"
        value={0.75}
        valueText="3 of 4 artists"
      />,
    );
    expect(bar).toHaveAttribute("aria-valuenow", "75");
    expect(bar).toHaveAttribute("aria-valuetext", "3 of 4 artists");
    expect(fill.style.getPropertyValue("--p")).toBe("0.75");
    expect(bar).not.toHaveAttribute("data-animated", "true");
  });

  it.each([
    [-0.5, "0", "0"],
    [0, "0", "0"],
    [1.5, "100", "1"],
  ])(
    "clamps finite progress %s to the accessible and visual range",
    (value, now, ratio) => {
      render(<ProgressHairline label="Upload" value={value} />);
      const bar = screen.getByRole("progressbar", { name: "Upload" });
      expect(bar).toHaveAttribute("aria-valuenow", now);
      const fill = bar.querySelector(
        ".crate-progress-hairline-fill",
      ) as HTMLElement;
      expect(fill.style.getPropertyValue("--p")).toBe(ratio);
    },
  );

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("keeps unknown or invalid progress %s indeterminate", (value) => {
    render(<ProgressHairline label="Waiting for transfer" value={value} />);
    const bar = screen.getByRole("progressbar", {
      name: "Waiting for transfer",
    });
    expect(bar).toHaveAttribute("data-indeterminate", "true");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).not.toHaveAttribute("data-animated", "true");
  });

  it("animates indeterminate progress only after intersection and stops when it leaves view", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const timeout = vi.spyOn(window, "setTimeout");
    const interval = vi.spyOn(window, "setInterval");
    const { unmount } = render(<ProgressHairline label="Preparing upload" />);
    const bar = screen.getByRole("progressbar", { name: "Preparing upload" });
    expect(observe).toHaveBeenCalledWith(bar);
    expect(bar).not.toHaveAttribute("data-animated", "true");
    intersect(true);
    expect(bar).toHaveAttribute("data-animated", "true");
    intersect(false);
    expect(bar).not.toHaveAttribute("data-animated", "true");
    expect(raf).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("responds to OS, Crate and document motion restrictions while remaining accessible", async () => {
    render(
      <ProgressHairline
        label="Preparing upload"
        valueText="Waiting for server"
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Preparing upload" });
    intersect(true);
    expect(bar).toHaveAttribute("data-animated", "true");

    act(() => setReducedMotion(true));
    expect(bar).not.toHaveAttribute("data-animated", "true");
    act(() => setReducedMotion(false));
    expect(bar).toHaveAttribute("data-animated", "true");
    await act(async () => {
      document.documentElement.dataset.crateMotion = "reduced";
      await Promise.resolve();
    });
    expect(bar).not.toHaveAttribute("data-animated", "true");
    await act(async () => {
      delete document.documentElement.dataset.crateMotion;
      await Promise.resolve();
    });
    expect(bar).toHaveAttribute("data-animated", "true");
    act(() => {
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(bar).not.toHaveAttribute("data-animated", "true");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-valuetext", "Waiting for server");
    act(() => {
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(bar).toHaveAttribute("data-animated", "true");
  });

  it("falls back to static indeterminate progress when intersection observation is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<ProgressHairline label="Waiting for connection" />);
    expect(
      screen.getByRole("progressbar", { name: "Waiting for connection" }),
    ).not.toHaveAttribute("data-animated", "true");
  });
});
