import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIButton } from "./AIButton";

describe("AIButton", () => {
  it("renders children", () => {
    render(<AIButton>Generate</AIButton>);
    expect(
      screen.getByRole("button", { name: /Generate/i }),
    ).toBeInTheDocument();
  });

  it("shows spinner when loading", () => {
    render(<AIButton loading>Generate</AIButton>);
    expect(screen.getByRole("button").querySelector("svg")).toHaveClass(
      "animate-spin",
    );
  });

  it("is disabled when loading", () => {
    render(<AIButton loading>Generate</AIButton>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when disabled prop is true", () => {
    render(<AIButton disabled>Generate</AIButton>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(<AIButton onClick={handleClick}>Generate</AIButton>);
    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
