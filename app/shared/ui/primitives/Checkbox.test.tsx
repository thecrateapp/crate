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
    expect(screen.getByRole("checkbox")).toHaveClass(
      "focus-visible:outline-solid",
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-focus-ring",
    );
  });
});
