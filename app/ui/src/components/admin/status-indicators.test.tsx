import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeverityMeter, severityTone } from "./status-indicators";

describe("SeverityMeter", () => {
  it.each([
    ["debug", "debug", "text-text-subtle"],
    ["info", "info", "text-accent-action-hi"],
    ["low", "info", "text-accent-action-hi"],
    ["safe", "info", "text-accent-action-hi"],
    ["warn", "warn", "text-state-warning-text"],
    ["caution", "warn", "text-state-warning-text"],
    ["error", "error", "text-state-danger-text"],
    ["destructive", "error", "text-state-danger-text"],
    ["critical", "critical", "text-state-danger-text"],
    ["progress", "neutral", "text-text-secondary"],
  ] as const)("shows %s as a %s dot and mono word", (level, tone, color) => {
    const { container } = render(<SeverityMeter level={level} label={level} />);
    const severity = container.querySelector('[data-slot="severity"]');
    expect(severity).toHaveAttribute("data-tone", tone);
    expect(severity).toHaveClass("font-mono", "uppercase", color);
    expect(screen.getByText(level)).toBeVisible();
    expect(severity?.querySelector('[aria-hidden="true"]')).toHaveClass(
      "rounded-full",
      "bg-current",
    );
  });

  it("rings only the critical dot", () => {
    const { container } = render(
      <>
        <SeverityMeter level="fatal" label="fatal" />
        <SeverityMeter level="error" label="error" />
      </>,
    );
    const [fatal, error] = container.querySelectorAll(
      '[data-slot="severity"] > [aria-hidden="true"]',
    );
    expect(fatal).toHaveClass("outline-1");
    expect(error).not.toHaveClass("outline-1");
  });

  it("normalizes casing and whitespace", () => {
    expect(severityTone(" WARNING ")).toBe("warn");
    expect(severityTone(null)).toBe("neutral");
  });
});
