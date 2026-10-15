import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusDot } from "./StatusDot";

function reducedMotionMedia(matches = false) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  } as unknown as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(query);

  return {
    set(next: boolean) {
      (query as { matches: boolean }).matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("StatusDot", () => {
  beforeEach(() => {
    reducedMotionMedia();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset.crateMotion;
  });

  it("renders a filled accent dot with a mono label when on", () => {
    const { container } = render(<StatusDot label="In library" />);

    const root = container.firstElementChild!;
    expect(root).toHaveAttribute("data-tone", "on");
    expect(root).toHaveClass("text-accent-action-hi", "font-mono", "uppercase");
    expect(root.querySelector("[aria-hidden='true']")).toHaveClass(
      "bg-current",
    );
    expect(screen.getByText("In library")).toBeInTheDocument();
  });

  it("renders a hollow ring in the subtle tone when off", () => {
    const { container } = render(<StatusDot tone="off" label="Missing" />);

    const root = container.firstElementChild!;
    expect(root).toHaveClass("text-text-subtle");
    expect(root.querySelector("[aria-hidden='true']")).toHaveClass(
      "border",
      "border-current",
    );
  });

  it("keeps amber for warning status only", () => {
    const { container } = render(<StatusDot tone="warn" label="No preset" />);

    expect(container.firstElementChild).toHaveClass("text-state-warning-text");
  });

  it("exposes a dot without a label as an image named by its title", () => {
    render(<StatusDot title="Attending" />);

    expect(screen.getByRole("img", { name: "Attending" })).toBeInTheDocument();
  });

  it("leaves a labelled status in the text flow instead of naming it twice", () => {
    render(<StatusDot label="Ready" title="Snapshot ready" />);

    expect(screen.getByText("Ready")).not.toHaveAttribute("role", "img");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("pulses only when requested", () => {
    const { container, rerender } = render(<StatusDot label="Building" />);

    expect(container.querySelector(".animate-pulse-subtle")).toBeNull();

    rerender(<StatusDot label="Building" pulse />);

    expect(container.querySelector("[aria-hidden='true']")).toHaveClass(
      "animate-pulse-subtle",
    );
  });

  it("stops an active pulse when the OS requests reduced motion", () => {
    const media = reducedMotionMedia();
    const { container } = render(<StatusDot label="Building" pulse />);
    const dot = container.querySelector("[aria-hidden='true']");

    expect(dot).toHaveClass("animate-pulse-subtle");

    act(() => media.set(true));

    expect(dot).not.toHaveClass("animate-pulse-subtle");
  });

  it("does not start a pulse under reduced OS motion", () => {
    reducedMotionMedia(true);
    const { container } = render(<StatusDot label="Building" pulse />);

    expect(container.querySelector(".animate-pulse-subtle")).toBeNull();
  });

  it("stops the pulse when the app motion gate changes", async () => {
    const { container } = render(<StatusDot label="Building" pulse />);
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).toHaveClass("animate-pulse-subtle");

    document.documentElement.dataset.crateMotion = "reduced";

    await waitFor(() => expect(dot).not.toHaveClass("animate-pulse-subtle"));
  });

  it("stops the pulse while the document is hidden", () => {
    const { container } = render(<StatusDot label="Building" pulse />);
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).toHaveClass("animate-pulse-subtle");

    act(() => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(dot).not.toHaveClass("animate-pulse-subtle");
  });

  it.each(["on", "off", "warn"] as const)(
    "preserves the %s shape with the shared forced-colors recipe",
    (tone) => {
      const { container } = render(<StatusDot tone={tone} label={tone} />);
      const dot = container.querySelector("[aria-hidden='true']");

      expect(container.firstElementChild).toHaveAttribute("data-tone", tone);
      expect(dot).toHaveClass("crate-status-dot");
      if (tone === "off") {
        expect(dot).not.toHaveClass("bg-current");
      }
    },
  );
});
