import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Progress } from "./progress";

describe("Progress Radix semantics", () => {
  it.each([
    [0, "loading"],
    [50, "loading"],
    [100, "complete"],
  ] as const)(
    "exposes a measured %i out of 100 with the correct state",
    (value, state) => {
      render(<Progress aria-label="Import progress" value={value} />);
      const progress = screen.getByRole("progressbar", {
        name: "Import progress",
      });
      expect(progress).toHaveAttribute("aria-valuemin", "0");
      expect(progress).toHaveAttribute("aria-valuemax", "100");
      expect(progress).toHaveAttribute("aria-valuenow", String(value));
      expect(progress).toHaveAttribute("aria-valuetext", `${value}%`);
      expect(progress).toHaveAttribute("data-state", state);
      expect(
        progress.querySelector('[data-slot="progress-indicator"]'),
      ).toHaveAttribute("data-state", state);
    },
  );

  it.each([undefined, null])("keeps %s progress indeterminate", (value) => {
    render(<Progress aria-label="Import progress" value={value} />);
    const progress = screen.getByRole("progressbar", {
      name: "Import progress",
    });
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress).not.toHaveAttribute("aria-valuetext");
    expect(progress).toHaveAttribute("data-state", "indeterminate");
  });

  it("preserves the caller's range and accessible value description", () => {
    render(
      <Progress
        aria-label="Files imported"
        value={50}
        max={200}
        getValueLabel={(value, max) => `${value} of ${max} files`}
      />,
    );
    const progress = screen.getByRole("progressbar", {
      name: "Files imported",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "50");
    expect(progress).toHaveAttribute("aria-valuemax", "200");
    expect(progress).toHaveAttribute("aria-valuetext", "50 of 200 files");
    expect(
      progress.querySelector('[data-slot="progress-indicator"]'),
    ).toHaveStyle({ transform: "translateX(-75%)" });
  });

  it("uses Radix's default range when the caller gives an invalid maximum", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<Progress aria-label="Import progress" value={50} max={0} />);
      const progress = screen.getByRole("progressbar", {
        name: "Import progress",
      });
      expect(progress).toHaveAttribute("aria-valuemax", "100");
      expect(progress).toHaveAttribute("aria-valuenow", "50");
      expect(
        progress.querySelector('[data-slot="progress-indicator"]'),
      ).toHaveStyle({ transform: "translateX(-50%)" });
    } finally {
      error.mockRestore();
    }
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "lets Radix reject invalid value %s without publishing a fabricated clamped measurement",
    (value) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        render(<Progress aria-label="Import progress" value={value} />);
        const progress = screen.getByRole("progressbar", {
          name: "Import progress",
        });
        expect(progress).not.toHaveAttribute("aria-valuenow");
        expect(progress).toHaveAttribute("data-state", "indeterminate");
        expect(
          progress.querySelector('[data-slot="progress-indicator"]'),
        ).toHaveStyle({ transform: "translateX(-100%)" });
        expect(error).toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
    },
  );
});
