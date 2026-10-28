import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Meter } from "./Meter";

describe("Meter", () => {
  it("exposes the actual range and formatted value and writes the fill ratio through its ref", () => {
    const valueRef = createRef<HTMLElement>();
    const { rerender } = render(
      <Meter
        label="Tracks"
        value={8}
        max={10}
        valueText="8 / 10"
        valueRef={valueRef}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Tracks" });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
    expect(meter).toHaveAttribute("aria-valuenow", "8");
    expect(meter).toHaveAttribute("aria-valuetext", "8 / 10");
    expect(meter.querySelector(".crate-meter-track")).not.toHaveAttribute(
      "data-thickness",
    );
    expect(screen.getByText("8 / 10")).toBeInTheDocument();
    expect(valueRef.current?.style.getPropertyValue("--v")).toBe("0.8");
    expect(valueRef.current).toHaveClass("bg-accent-action-hi", "origin-left");

    valueRef.current?.style.setProperty("--v", "0.85");
    expect(meter).toHaveAttribute("aria-valuenow", "8");
    rerender(
      <Meter
        label="Tracks"
        value={9}
        max={10}
        valueText="9 / 10"
        valueRef={valueRef}
      />,
    );
    expect(valueRef.current?.style.getPropertyValue("--v")).toBe("0.9");
    expect(meter).toHaveAttribute("aria-valuenow", "9");
    expect(meter).toHaveAttribute("aria-valuetext", "9 / 10");
  });

  it("positions the limit tick against the actual maximum", () => {
    const { container } = render(
      <Meter
        label="Storage"
        value={25}
        max={200}
        limit={150}
        valueText="25 / 200 GB"
      />,
    );
    const tick = container.querySelector(".bg-text-primary");
    expect(tick).toBeInTheDocument();
    expect(tick).toHaveStyle({ left: "75%" });
  });

  it("identifies an over-limit value in text as well as warning color", () => {
    const valueRef = createRef<HTMLElement>();
    render(
      <Meter
        label="Transcoding"
        value={5}
        max={4}
        over
        valueText="5 / 4"
        valueRef={valueRef}
      />,
    );

    expect(screen.getByText("over · max 4")).toBeInTheDocument();
    expect(valueRef.current).toHaveClass("bg-state-warning");
    expect(screen.getByText("5 / 4")).toHaveClass("text-state-warning");
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "5 / 4",
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "4");
  });

  it("renders unavailable measurements as n/a without inventing a value or a fill", () => {
    const valueRef = createRef<HTMLElement>();
    render(
      <Meter
        label="Transcoding"
        value={null}
        max={4}
        valueText="Unknown capacity"
        valueRef={valueRef}
      />,
    );

    const meter = screen.getByRole("group", { name: "Transcoding" });
    expect(meter).not.toHaveAttribute("aria-valuenow");
    expect(meter).toHaveAccessibleDescription("n/a");
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.queryByText("Unknown capacity")).not.toBeInTheDocument();
    expect(valueRef.current).toBeNull();
  });

  it("forwards callback refs to the fill and clears them on unmount", () => {
    const valueRef = vi.fn();
    const { unmount } = render(
      <Meter
        label="Tracks"
        value={2}
        max={4}
        valueText="2 / 4"
        valueRef={valueRef}
      />,
    );

    expect(valueRef).toHaveBeenCalledWith(expect.any(HTMLElement));
    const fill = valueRef.mock.calls.find(
      ([node]) => node instanceof HTMLElement,
    )?.[0] as HTMLElement;
    expect(fill.style.getPropertyValue("--v")).toBe("0.5");
    unmount();
    expect(valueRef).toHaveBeenLastCalledWith(null);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not claim a range or produce a non-finite fill when max is %s",
    (max) => {
      const valueRef = createRef<HTMLElement>();
      render(
        <Meter
          label="Tracks"
          value={0}
          max={max}
          valueText="0 / 0"
          valueRef={valueRef}
        />,
      );

      expect(screen.getByRole("group", { name: "Tracks" })).not.toHaveAttribute(
        "aria-valuenow",
      );
      expect(
        screen.getByRole("group", { name: "Tracks" }),
      ).toHaveAccessibleDescription("0 / 0");
      expect(screen.queryByRole("meter")).not.toBeInTheDocument();
      expect(screen.getByText("0 / 0")).toBeInTheDocument();
      if (valueRef.current) {
        expect(
          Number.isFinite(
            Number(valueRef.current.style.getPropertyValue("--v")),
          ),
        ).toBe(true);
      }
    },
  );
});
