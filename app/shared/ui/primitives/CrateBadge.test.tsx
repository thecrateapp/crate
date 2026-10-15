import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CrateBadge, CratePill, CrateChip } from "./CrateBadge";
import { Sparkles } from "@crate/ui/icons";

describe("CratePill", () => {
  it("renders children", () => {
    const { container } = render(<CratePill>Label</CratePill>);
    expect(screen.getByText("Label")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "font-mono",
      "text-label",
      "tracking-chip",
      "min-h-8",
      "[@media(pointer:coarse)]:min-h-11",
    );
    expect(container.firstElementChild).toHaveAttribute("data-slot", "chip");
  });

  it("renders as a button when onClick is provided", () => {
    render(<CratePill onClick={() => {}}>Clickable</CratePill>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button")).toHaveAttribute("data-slot", "chip");
  });

  it("renders as a span when onClick is not provided", () => {
    render(<CratePill>Static</CratePill>);
    expect(screen.getByText("Static").tagName).toBe("SPAN");
  });

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(<CratePill onClick={handleClick}>Clickable</CratePill>);
    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders an explicit toggle as a button even without a callback", () => {
    render(
      <CratePill variant="toggle" active>
        Selected
      </CratePill>,
    );
    expect(
      screen.getByRole("button", { name: "Selected", pressed: true }),
    ).toHaveAttribute("type", "button");
  });

  it("updates the pressed state and styling of an explicit toggle", () => {
    const { rerender } = render(<CratePill variant="toggle">Jazz</CratePill>);
    expect(screen.getByRole("button", { pressed: false })).not.toHaveClass(
      "bg-accent-action-hi",
    );
    rerender(
      <CratePill variant="toggle" active>
        Jazz
      </CratePill>,
    );
    expect(screen.getByRole("button", { pressed: true })).toHaveClass(
      "border-accent-action-hi",
      "bg-accent-action-hi",
      "text-accent-action-hi-foreground",
    );
  });

  it("keeps actions as ordinary buttons and ignores the toggle active prop", async () => {
    const onClick = vi.fn();
    render(
      <CratePill variant="action" active onClick={onClick}>
        Resume
      </CratePill>,
    );
    const action = screen.getByRole("button", { name: "Resume" });
    expect(action).toHaveAttribute("type", "button");
    expect(action).not.toHaveAttribute("aria-pressed");
    expect(action).not.toHaveClass("bg-accent-action-hi");
    await userEvent.click(action);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders an action button without a callback", () => {
    render(<CratePill variant="action">Start</CratePill>);
    expect(screen.getByRole("button", { name: "Start" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("keeps explicit static pills non-interactive even if a callback and active are passed", async () => {
    const onClick = vi.fn();
    render(
      <CratePill variant="static" active onClick={onClick}>
        Imported
      </CratePill>,
    );
    const pill = screen.getByText("Imported");
    expect(pill.tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(pill).not.toHaveAttribute("aria-pressed");
    expect(pill).not.toHaveClass("bg-accent-action-hi");
    await userEvent.click(pill);
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(["toggle", "action"] as const)(
    "prevents callbacks when a %s is disabled",
    async (variant) => {
      const onClick = vi.fn();
      render(
        <CratePill variant={variant} onClick={onClick} disabled>
          Unavailable
        </CratePill>,
      );
      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  it("keeps action pills reachable with Tab", async () => {
    render(<CratePill variant="action">Resume</CratePill>);
    const button = screen.getByRole("button");
    await userEvent.tab();
    expect(button).toHaveFocus();
  });

  it("renders the v3 chip: mono text, solid bright accent when active", () => {
    render(
      <>
        <CratePill onClick={() => {}} active>
          punk
        </CratePill>
        <CratePill onClick={() => {}}>doom</CratePill>
      </>,
    );

    const active = screen.getByRole("button", { name: "punk" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(active).toHaveClass(
      "font-mono",
      "bg-accent-action-hi",
      "text-accent-action-hi-foreground",
    );
    expect(active).not.toHaveClass("hover:text-text-primary");
    expect(screen.getByRole("button", { name: "doom" })).not.toHaveClass(
      "bg-accent-action-hi",
    );
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <CratePill onClick={() => {}} disabled>
        Disabled
      </CratePill>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("CrateChip", () => {
  it("renders children", () => {
    const { container } = render(<CrateChip>Tag</CrateChip>);
    expect(screen.getByText("Tag")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "rounded-full",
      "border",
      "px-2",
      "py-0.5",
      "font-mono",
      "text-badge",
    );
  });

  it("renders as a span", () => {
    render(<CrateChip>Tag</CrateChip>);
    expect(screen.getByText("Tag").tagName).toBe("SPAN");
  });
});

describe("CrateBadge tones", () => {
  it("applies state tone classes to chips", () => {
    render(<CrateChip tone="success">Ok</CrateChip>);
    const chip = screen.getByText("Ok");
    expect(chip).toHaveClass(
      "bg-state-success/10",
      "text-state-success-text",
      "text-badge",
    );
    expect(chip).toHaveAttribute("data-tone", "success");
  });

  it("applies tone classes to static pills", () => {
    render(<CratePill tone="danger">Error</CratePill>);
    expect(screen.getByText("Error")).toHaveClass("text-state-danger-text");
  });

  it("keeps the active style over the tone", () => {
    render(
      <CrateChip tone="warning" active>
        Active
      </CrateChip>,
    );
    expect(screen.getByText("Active")).not.toHaveClass(
      "text-state-warning-text",
    );
  });

  it("lets className override defaults", () => {
    render(<CrateChip className="text-micro">Small</CrateChip>);
    const chip = screen.getByText("Small");
    expect(chip).toHaveClass("text-micro");
    expect(chip).not.toHaveClass("text-badge");
  });

  it("exposes aria-pressed on inferred toggle pills", () => {
    const { rerender } = render(
      <CratePill onClick={() => {}} active>
        On
      </CratePill>,
    );
    expect(screen.getByRole("button", { pressed: true })).toBeInTheDocument();
    rerender(<CratePill onClick={() => {}}>On</CratePill>);
    expect(screen.getByRole("button", { pressed: false })).toBeInTheDocument();
  });

  it("does not set aria-pressed on static pills", () => {
    render(<CratePill active>Static</CratePill>);
    expect(screen.getByText("Static")).not.toHaveAttribute("aria-pressed");
    expect(screen.getByText("Static")).not.toHaveClass("bg-accent-action-hi");
  });
});

describe("CrateBadge", () => {
  it("renders a rectangular badge with primary text", () => {
    render(<CrateBadge>Next show</CrateBadge>);
    const badge = screen.getByText("Next show");
    expect(badge).toHaveClass("crate-badge", "rounded-md", "text-badge");
    expect(badge.className).not.toMatch(/uppercase|tracking-|rounded-full/);
    expect(badge.className).not.toContain("text-accent-action");
  });

  it("puts the tone color on the icon only", () => {
    const { container } = render(
      <CrateBadge icon={Sparkles} tone="warning">
        Crate DNA
      </CrateBadge>,
    );
    const badge = screen.getByText("Crate DNA");
    expect(badge).toHaveAttribute("data-tone", "warning");
    expect(badge.className).not.toContain("text-state-warning-text");
    expect(container.querySelector("svg")).toHaveClass(
      "text-state-warning-text",
    );
  });

  it("defaults the icon to the accent color", () => {
    const { container } = render(
      <CrateBadge icon={Sparkles}>Crate DNA</CrateBadge>,
    );
    expect(container.querySelector("svg")).toHaveClass("text-accent-action");
  });

  it("supports the larger size and the overlay surface", () => {
    render(
      <CrateBadge size="md" surface="overlay">
        Pre-release
      </CrateBadge>,
    );
    const badge = screen.getByText("Pre-release");
    expect(badge).toHaveClass("text-xs");
    expect(badge).toHaveAttribute("data-surface", "overlay");
  });
});
