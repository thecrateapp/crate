import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ActionIconButton,
  ActionIconLink,
} from "@crate/ui/primitives/ActionIconButton";

describe("ActionIconButton", () => {
  it("renders as a button with children", () => {
    render(
      <ActionIconButton aria-label="Edit">
        <span data-testid="icon">Icon</span>
      </ActionIconButton>,
    );

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<ActionIconButton disabled>Click</ActionIconButton>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("ActionIconLink", () => {
  it("renders as an anchor with href", () => {
    render(<ActionIconLink href="/test">Link</ActionIconLink>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/test");
  });
});
