import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionIconButton, ActionIconLink } from "./ActionIconButton";

describe("ActionIconButton", () => {
  it("renders children", () => {
    render(<ActionIconButton>Icon</ActionIconButton>);
    expect(screen.getByRole("button", { name: /Icon/i })).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<ActionIconButton disabled>Icon</ActionIconButton>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(<ActionIconButton onClick={handleClick}>Icon</ActionIconButton>);
    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("applies active tone when active", () => {
    const { container } = render(
      <ActionIconButton active>Icon</ActionIconButton>,
    );
    expect(container.querySelector("button")).toHaveClass("text-primary");
  });

  it("uses glow-only hover without framed hover backgrounds", () => {
    const { container } = render(<ActionIconButton>Icon</ActionIconButton>);
    const button = container.querySelector("button");

    expect(button?.className).toContain("hover:text-primary");
    expect(button?.className).toContain("hover:drop-shadow");
    expect(button?.className).not.toContain("hover:bg-");
  });

  it("adds a subtle pulse for active icon states", () => {
    const { container } = render(
      <ActionIconButton active>Icon</ActionIconButton>,
    );

    expect(container.querySelector("button")).toHaveClass(
      "animate-crate-icon-active-pulse",
    );
  });

  it("forwards ref correctly", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<ActionIconButton ref={ref}>Icon</ActionIconButton>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

describe("ActionIconLink", () => {
  it("renders as anchor", () => {
    render(<ActionIconLink href="/path">Link</ActionIconLink>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/path");
  });

  it("sets aria-disabled when href is missing", () => {
    render(<ActionIconLink>Link</ActionIconLink>);
    expect(screen.getByRole("link")).toHaveAttribute("aria-disabled", "true");
  });

  it("falls back to # when href is missing", () => {
    render(<ActionIconLink>Link</ActionIconLink>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "#");
  });
});
