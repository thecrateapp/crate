import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkles } from "@crate/ui/icons";
import { InfoBadge } from "./InfoBadge";

describe("InfoBadge", () => {
  it("derives a complete title from composed text and keeps explicit titles", () => {
    const { rerender } = render(<InfoBadge>alias: {"a-long-alias"}</InfoBadge>);
    expect(screen.getByText("alias: a-long-alias")).toHaveAttribute(
      "title",
      "alias: a-long-alias",
    );
    rerender(<InfoBadge title="Explicit">alias: {"a-long-alias"}</InfoBadge>);
    expect(screen.getByText("alias: a-long-alias")).toHaveAttribute(
      "title",
      "Explicit",
    );
  });
  it("retains semantic icon color on overlay surfaces", () => {
    const { container } = render(
      <InfoBadge tone="danger" surface="overlay" icon={Sparkles} />,
    );
    expect(container.querySelector("svg")).toHaveClass(
      "text-state-danger-text",
    );
  });
  it("uses an explicit counter variant for balanced numeral spacing", () => {
    render(<InfoBadge variant="counter">3</InfoBadge>);
    expect(screen.getByText("3")).toHaveAttribute("data-variant", "counter");
  });
  it("exposes full long text through its title without creating a toggle", () => {
    const label =
      "A long metadata value that must remain available in a narrow row";
    render(<InfoBadge>{label}</InfoBadge>);
    expect(screen.getByText(label)).toHaveAttribute("title", label);
    expect(screen.getByText(label)).toHaveAttribute("data-slot", "info-badge");
    expect(screen.getByText(label)).not.toHaveAttribute("aria-pressed");
  });
  it.each([
    "neutral",
    "info",
    "success",
    "warning",
    "danger",
    "accent",
  ] as const)("preserves the %s meaning with identical geometry", (tone) => {
    render(
      <InfoBadge tone={tone} icon={Sparkles}>
        {tone}
      </InfoBadge>,
    );
    expect(
      screen.getByText(tone).closest("[data-slot=info-badge]")!,
    ).toHaveClass("crate-info-badge", "text-info-badge", "font-mono");
    expect(
      screen.getByText(tone).closest("[data-slot=info-badge]")!,
    ).toHaveAttribute("data-tone", tone);
    expect(
      screen
        .getByText(tone)
        .closest("[data-slot=info-badge]")!
        .querySelector("svg"),
    ).toHaveAttribute("aria-hidden", "true");
  });
  it("keeps the overlay surface and an explicit accessible label on an icon-only status", () => {
    render(
      <InfoBadge
        icon={Sparkles}
        surface="overlay"
        aria-label="Available offline"
        title="Download complete"
      />,
    );
    expect(screen.getByLabelText("Available offline")).toHaveAttribute(
      "data-surface",
      "overlay",
    );
    expect(screen.getByLabelText("Available offline")).toHaveAttribute(
      "title",
      "Download complete",
    );
  });
});
