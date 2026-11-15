import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Sparkles } from "@crate/ui/icons";
import { InfoBadge } from "./InfoBadge";

describe("InfoBadge", () => {
  it("keeps composed and explicit detail in a custom tooltip", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InfoBadge>alias: {"a-long-alias"}</InfoBadge>);
    const badge = screen.getByText("alias: a-long-alias");
    expect(badge).not.toHaveAttribute("title");
    await user.hover(badge);
    expect(
      await screen.findByRole("tooltip", { name: "alias: a-long-alias" }),
    ).toBeVisible();
    await user.unhover(badge);
    await user.keyboard("{Escape}");
    rerender(<InfoBadge title="Explicit">alias: {"a-long-alias"}</InfoBadge>);
    expect(screen.getByText("alias: a-long-alias")).toBe(badge);
    await user.hover(badge);
    expect(
      await screen.findByRole("tooltip", { name: "Explicit" }),
    ).toBeVisible();
  });
  it("retains semantic icon color on overlay surfaces", () => {
    const { container } = render(
      <InfoBadge tone="danger" surface="overlay" icon={Sparkles} />,
    );
    expect(container.querySelector("svg")).toHaveClass(
      "text-state-danger-text",
    );
  });
  it("draws an icon-only variant as a named round mark of the badge height", () => {
    render(
      <InfoBadge
        variant="icon"
        icon={Sparkles}
        tone="accent"
        aria-label="Smart Mix: all 118 tracks have stems"
      />,
    );
    const badge = screen.getByRole("img", {
      name: "Smart Mix: all 118 tracks have stems",
    });
    expect(badge).toHaveAttribute("data-variant", "icon");
    expect(badge).toHaveClass("crate-info-badge", "rounded-full");
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // The recipe, not the caller, makes it a circle: as wide as the badge is high.
    const recipes = readFileSync(
      resolve(__dirname, "../tokens/recipes.css"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(recipes).toContain(
      '.crate-info-badge[data-variant="icon"] { width: var(--info-badge-height); min-width: var(--info-badge-height); padding: 0; }',
    );
  });
  it("uses an explicit counter variant for balanced numeral spacing", () => {
    render(<InfoBadge variant="counter">3</InfoBadge>);
    expect(screen.getByText("3")).toHaveAttribute("data-variant", "counter");
  });
  it("exposes full long text through its custom tooltip without creating a toggle", () => {
    const label =
      "A long metadata value that must remain available in a narrow row";
    render(<InfoBadge>{label}</InfoBadge>);
    expect(screen.getByText(label)).not.toHaveAttribute("title");
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
    expect(screen.getByLabelText("Available offline")).not.toHaveAttribute(
      "title",
    );
  });
});
