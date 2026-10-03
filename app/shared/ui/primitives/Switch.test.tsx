import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Switch } from "./Switch";

describe("Switch", () => {
  it("toggles and reports changes", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Autoplay" onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole("switch", { name: "Autoplay" });
    expect(control).toHaveAttribute("aria-checked", "false");
    await userEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("respects controlled state and disabled", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        aria-label="Locked"
        checked
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );
    const control = screen.getByRole("switch");
    expect(control).toBeDisabled();
    await userEvent.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("applies size and focus ring", () => {
    render(<Switch aria-label="Small" size="sm" />);
    expect(screen.getByRole("switch")).toHaveClass(
      "h-5",
      "w-9",
      "focus-visible:shadow-focus",
    );
  });
});
