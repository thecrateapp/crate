import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Input } from "./input";

describe("Input", () => {
  it("forwards its ref and native form attributes", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <form aria-label="Metadata">
        <label htmlFor="album-title">Album title</label>
        <Input
          ref={ref}
          id="album-title"
          name="title"
          type="text"
          defaultValue="Kid A"
          autoComplete="off"
          maxLength={80}
          placeholder="Untitled"
          className="consumer-input"
          data-source="metadata"
        />
      </form>,
    );

    const input = screen.getByRole("textbox", { name: "Album title" });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("maxlength", "80");
    expect(input).toHaveAttribute("placeholder", "Untitled");
    expect(input).toHaveAttribute("data-source", "metadata");
    expect(input).toHaveClass("crate-form-control", "consumer-input");
    expect(
      new FormData(screen.getByRole("form") as HTMLFormElement).get("title"),
    ).toBe("Kid A");
  });

  it("preserves controlled values and native change and blur callbacks", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const { rerender } = render(
      <Input
        aria-label="Artist"
        value="Björk"
        onChange={onChange}
        onBlur={onBlur}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Artist" });

    fireEvent.change(input, { target: { value: "Burial" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("Björk");
    rerender(
      <Input
        aria-label="Artist"
        value="Burial"
        onChange={onChange}
        onBlur={onBlur}
      />,
    );
    expect(input).toHaveValue("Burial");
    await userEvent.click(input);
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("keeps invalid descriptions and the shared keyboard outline", () => {
    render(
      <>
        <Input aria-label="Title" aria-invalid aria-describedby="title-error" />
        <p id="title-error">Enter a title</p>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a title");
    expect(input.className).not.toMatch(
      /state-danger|backdrop-blur|shadow-control/,
    );
    expect(input).not.toHaveClass("outline-none", "outline-hidden");
  });

  it("prevents changes when disabled", async () => {
    const onChange = vi.fn();
    render(
      <Input
        aria-label="Locked"
        defaultValue="Original"
        disabled
        onChange={onChange}
      />,
    );
    await userEvent.type(screen.getByRole("textbox"), "Changed");
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveValue("Original");
    expect(onChange).not.toHaveBeenCalled();
  });
});
