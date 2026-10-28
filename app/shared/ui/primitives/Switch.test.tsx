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

  it("preserves the size prop and shared keyboard outline", () => {
    render(<Switch aria-label="Small" size="sm" />);
    expect(screen.getByRole("switch")).toHaveAttribute("data-size", "sm");
    expect(screen.getByRole("switch")).toHaveClass("crate-form-switch");
    expect(screen.getByRole("switch")).not.toHaveClass("outline-none");
  });

  it("toggles with Space and retains native form participation", async () => {
    const onCheckedChange = vi.fn();
    render(
      <form aria-label="Playback settings">
        <Switch
          aria-label="Autoplay"
          name="autoplay"
          value="enabled"
          size="md"
          onCheckedChange={onCheckedChange}
        />
      </form>,
    );
    const control = screen.getByRole("switch", { name: "Autoplay" });
    expect(control).toHaveAttribute("data-size", "md");
    await userEvent.tab();
    expect(control).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(
      new FormData(screen.getByRole("form") as HTMLFormElement).get("autoplay"),
    ).toBe("enabled");
  });
});
