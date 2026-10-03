import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CratePill, CrateChip } from "./CrateBadge";

describe("CratePill", () => {
  it("renders children", () => {
    const { container } = render(<CratePill>Label</CratePill>);
    expect(screen.getByText("Label")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("text-badge");
  });

  it("renders as a button when onClick is provided", () => {
    render(<CratePill onClick={() => {}}>Clickable</CratePill>);
    expect(screen.getByRole("button")).toBeInTheDocument();
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
    expect(container.firstElementChild).toHaveClass("text-badge");
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
    render(<CrateChip className="text-[10px]">Small</CrateChip>);
    const chip = screen.getByText("Small");
    expect(chip).toHaveClass("text-[10px]");
    expect(chip).not.toHaveClass("text-badge");
  });

  it("exposes aria-pressed and a focus ring on interactive pills", () => {
    const { rerender } = render(
      <CratePill onClick={() => {}} active>
        On
      </CratePill>,
    );
    expect(screen.getByRole("button", { pressed: true })).toHaveClass(
      "focus-visible:shadow-focus",
    );
    rerender(<CratePill onClick={() => {}}>On</CratePill>);
    expect(screen.getByRole("button", { pressed: false })).toBeInTheDocument();
  });

  it("does not set aria-pressed on static pills", () => {
    render(<CratePill active>Static</CratePill>);
    expect(screen.getByText("Static")).not.toHaveAttribute("aria-pressed");
  });
});
