import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EqBands, eqCurvePath, formatGain } from "./EqBands";

const FLAT = Array.from({ length: 10 }, () => 0);

describe("EqBands", () => {
  it("draws the hairline grid, the accent curve and one numeral per band", () => {
    const { container } = render(
      <EqBands
        gains={[2, 3, 1, -1, 2, 4, 4, 3, 1, -1]}
        onBandChange={vi.fn()}
      />,
    );

    expect(container.querySelector(".stroke-border-quiet")).toBeInTheDocument();
    expect(
      container.querySelector("path.stroke-accent-action-hi"),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("rect")).toHaveLength(10);
    expect(screen.getByText("16K")).toHaveClass("font-mono");
    expect(screen.getAllByText("+4")).toHaveLength(2);
    expect(screen.getAllByText("−1")[0]).toHaveClass("font-display");
    expect(screen.getByText("0 dB")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("var(--idle-");
    expect(container.innerHTML).not.toContain("bg-primary");
  });

  it("maps a pointer drag on a band column to a snapped gain", () => {
    const onBandChange = vi.fn();
    const { container } = render(
      <EqBands gains={FLAT} onBandChange={onBandChange} />,
    );
    const band = container.querySelector<HTMLElement>("[data-band='5']")!;
    band.getBoundingClientRect = () =>
      ({ top: 0, height: 100, bottom: 100, left: 0, right: 10 }) as DOMRect;
    band.setPointerCapture = vi.fn();

    fireEvent.pointerDown(band, { clientY: 25, pointerId: 1 });

    expect(onBandChange).toHaveBeenCalledWith(5, 6);
  });

  it("ignores pointer input when disabled or read-only", () => {
    const onBandChange = vi.fn();
    const { container } = render(
      <EqBands gains={FLAT} onBandChange={onBandChange} disabled />,
    );
    const band = container.querySelector<HTMLElement>("[data-band='0']")!;

    fireEvent.pointerDown(band, { clientY: 10, pointerId: 1 });

    expect(onBandChange).not.toHaveBeenCalled();
    expect(container.firstElementChild).toHaveClass("opacity-40");
  });

  it("formats gains with typographic signs", () => {
    expect(formatGain(2)).toBe("+2");
    expect(formatGain(0)).toBe("0");
    expect(formatGain(-1.5)).toBe("−1.5");
  });

  it("builds a smooth path through every band centre", () => {
    const path = eqCurvePath(FLAT);

    expect(path.startsWith("M5 50")).toBe(true);
    expect(path.match(/C/g)).toHaveLength(9);
    expect(path.endsWith("95 50")).toBe(true);
  });
});
