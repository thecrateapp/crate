import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RadioGroup, RadioGroupItem } from "./RadioGroup";

describe("RadioGroup", () => {
  it("selects items and reports the value", async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        aria-label="Quality"
        defaultValue="high"
        onValueChange={onValueChange}
      >
        <RadioGroupItem value="high" aria-label="High" />
        <RadioGroupItem value="low" aria-label="Low" />
      </RadioGroup>,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Quality" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "High" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Low" }));
    expect(onValueChange).toHaveBeenCalledWith("low");
    expect(screen.getByRole("radio", { name: "Low" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("styles items with a focus ring", () => {
    render(
      <RadioGroup aria-label="Pick">
        <RadioGroupItem value="a" aria-label="A" />
      </RadioGroup>,
    );
    expect(screen.getByRole("radio")).toHaveClass("focus-visible:shadow-focus");
  });
});
