import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeverityMeter } from "./status-indicators";

describe("SeverityMeter", () => {
  it.each([
    ["safe", 1],
    ["caution", 2],
    ["destructive", 3],
    ["debug", 0],
    ["info", 1],
    ["warn", 2],
    ["error", 3],
    ["critical", 3],
    ["unknown", 0],
  ] as const)("shows %s as neutral segments plus its word", (level, active) => {
    const { container } = render(<SeverityMeter level={level} label={level} />);
    expect(screen.getByText(level)).toBeVisible();
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(3);
    expect(
      container.querySelectorAll('[data-segment][data-active="true"]'),
    ).toHaveLength(active);
    for (const segment of container.querySelectorAll("[data-segment]"))
      expect(segment.className).toMatch(/text-primary|text-subtle/);
    expect(container.innerHTML).not.toMatch(
      /(?:state-warning|state-danger|accent-action)/,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
