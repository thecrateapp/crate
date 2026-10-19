import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QualityBadge } from "./QualityBadge";

describe("QualityBadge", () => {
  it("renders hi-res source as the canonical warning mono tag", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "hi-res", label: "HI-RES", detail: "24-bit / 96 kHz" }}
      />,
    );
    const badge = container.firstElementChild;

    expect(container.textContent).toContain("HI-RES");
    expect(container.querySelector("svg")).toBeNull();
    expect(badge).toHaveClass(
      "text-info-badge",
      "font-mono",
      "font-normal",
      "border-state-warning/25",
      "text-state-warning-text",
      "bg-state-warning/10",
    );
  });

  it("keeps the lossless accent treatment for stream quality", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "lossless", label: "Lossless", detail: "FLAC" }}
        origin="stream"
      />,
    );
    const badge = container.firstElementChild;

    expect(container.querySelector("svg")).toBeNull();
    expect(badge).toHaveClass(
      "text-info-badge",
      "font-mono",
      "font-normal",
      "border-accent-action-hi/40",
      "text-accent-action-hi",
      "bg-accent-action/10",
    );
    expect(badge?.className).not.toMatch(
      /(?:border|text|bg)-(?:white|state-info)|rgba\(|shadow-\[/,
    );
  });

  it("renders standard badge as a neutral mono tag", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "standard", label: "MP3", detail: "320 kbps" }}
      />,
    );
    const badge = container.firstElementChild;

    expect(container.querySelector("svg")).toBeNull();
    expect(badge).toHaveClass(
      "text-info-badge",
      "font-mono",
      "font-normal",
      "border-border-quiet",
      "text-text-secondary",
      "bg-transparent",
    );
    expect(badge?.className).not.toMatch(
      /(?:border|text|bg)-(?:white|primary)|rgba\(|shadow-\[/,
    );
  });
});
