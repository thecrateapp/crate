import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OverlayCloseButton } from "./overlay-close-button";

describe("OverlayCloseButton", () => {
  it("provides an accessible non-submit close control with a decorative 24px icon", () => {
    render(<OverlayCloseButton />);

    const button = screen.getByRole("button", { name: "Close" });
    expect(button).toHaveAttribute("type", "button");
    const icon = button.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("width", "24");
    expect(icon).toHaveAttribute("height", "24");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("forwards its native props and ref for Radix composition", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <OverlayCloseButton
        ref={ref}
        aria-label="Cerrar biblioteca"
        title="Cerrar"
        className="consumer-position"
        data-slot="dialog-close"
        type="submit"
      />,
    );

    const button = screen.getByRole("button", {
      name: "Cerrar biblioteca",
    });
    expect(ref.current).toBe(button);
    expect(button).not.toHaveAttribute("title");
    expect(button).toHaveAttribute("data-slot", "dialog-close");
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("consumer-position");
  });

  it("calls the supplied close action once on activation", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<OverlayCloseButton onClick={onClick} />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("preserves the disabled state and blocks activation", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<OverlayCloseButton disabled onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Close" });

    expect(button).toBeDisabled();
    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});
