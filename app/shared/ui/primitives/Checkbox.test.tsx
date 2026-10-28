import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("toggles checked state", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox aria-label="Lossless" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "Lossless" });
    await userEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box).toHaveAttribute("aria-checked", "true");
  });

  it("supports indeterminate", () => {
    render(<Checkbox aria-label="Some" checked="indeterminate" />);
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "mixed",
    );
  });

  it("has a focus ring", () => {
    render(<Checkbox aria-label="Focus" />);
    expect(screen.getByRole("checkbox")).not.toHaveClass("outline-none");
  });

  it("turns an indeterminate selection into checked with Space", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        aria-label="All tracks"
        defaultChecked="indeterminate"
        onCheckedChange={onCheckedChange}
      />,
    );
    const control = screen.getByRole("checkbox", { name: "All tracks" });
    expect(control).toHaveClass("crate-form-checkbox");
    expect(control).toHaveAttribute("aria-checked", "mixed");
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange).toHaveBeenCalledOnce();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("keeps disabled controls unchanged", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        aria-label="Locked"
        checked
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );
    const control = screen.getByRole("checkbox");
    expect(control).toBeDisabled();
    await userEvent.click(control);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
