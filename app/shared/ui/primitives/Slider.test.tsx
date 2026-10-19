import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Slider } from "./Slider";
import { FormField } from "./FormField";
describe("Slider", () => {
  it("retains native range constraints, form value, association and ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <form aria-label="Settings">
        <FormField label="Crossfade">
          <Slider
            ref={ref}
            name="crossfade"
            min={0}
            max={12}
            step={0.5}
            defaultValue={4}
          />
        </FormField>
      </form>,
    );
    const slider = screen.getByRole("slider", { name: "Crossfade" });
    expect(ref.current).toBe(slider);
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("step", "0.5");
    expect(
      new FormData(screen.getByRole("form") as HTMLFormElement).get(
        "crossfade",
      ),
    ).toBe("4");
  });
  it("keeps controlled changes and mouse/touch commit callbacks", () => {
    const onChange = vi.fn(),
      onMouseUp = vi.fn(),
      onTouchEnd = vi.fn();
    render(
      <Slider
        aria-label="Threshold"
        value={70}
        min={50}
        max={100}
        onChange={onChange}
        onMouseUp={onMouseUp}
        onTouchEnd={onTouchEnd}
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "80" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(slider).toHaveValue("70");
    fireEvent.mouseUp(slider);
    fireEvent.touchEnd(slider);
    expect(onMouseUp).toHaveBeenCalledOnce();
    expect(onTouchEnd).toHaveBeenCalledOnce();
  });
  it("keeps disabled state, invalid description and keyboard focusability", () => {
    render(
      <FormField label="Gain" error="Unavailable">
        <Slider disabled defaultValue={0} />
      </FormField>,
    );
    expect(screen.getByRole("slider")).toBeDisabled();
    expect(screen.getByRole("slider")).toHaveAccessibleDescription(
      "Unavailable",
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-invalid", "true");
  });
});
