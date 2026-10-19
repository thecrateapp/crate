import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterChip } from "./FilterChip";

describe("FilterChip", () => {
  it("toggles by keyboard with native button semantics", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <FilterChip onClick={onClick}>Available</FilterChip>,
    );
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledOnce();
    rerender(
      <FilterChip active onClick={onClick}>
        Available
      </FilterChip>,
    );
    expect(screen.getByRole("button", { pressed: true })).toHaveClass(
      "crate-form-chip",
      "text-filter-chip",
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "active");
  });
  it("keeps actions free of selection state and respects disabled", async () => {
    const onClick = vi.fn();
    render(
      <FilterChip variant="action" active disabled onClick={onClick}>
        Reset
      </FilterChip>,
    );
    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button).toHaveAttribute("data-state", "inactive");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
