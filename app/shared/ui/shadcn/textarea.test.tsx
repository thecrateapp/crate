import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("forwards its ref and native attributes for code fields", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <form aria-label="Playlist rules">
        <label htmlFor="playlist-rules">Rules</label>
        <Textarea
          ref={ref}
          id="playlist-rules"
          name="rules"
          defaultValue={'{"genre":"ambient"}'}
          rows={6}
          maxLength={500}
          spellCheck={false}
          className="font-mono"
          data-format="json"
        />
      </form>,
    );
    const textarea = screen.getByRole("textbox", { name: "Rules" });
    expect(ref.current).toBe(textarea);
    expect(textarea).toHaveAttribute("rows", "6");
    expect(textarea).toHaveAttribute("maxlength", "500");
    expect(textarea).toHaveAttribute("spellcheck", "false");
    expect(textarea).toHaveAttribute("data-format", "json");
    expect(textarea).toHaveClass("crate-form-control", "font-mono");
    expect(
      new FormData(screen.getByRole("form") as HTMLFormElement).get("rules"),
    ).toBe('{"genre":"ambient"}');
  });

  it("preserves controlled editing and native blur callbacks", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const { rerender } = render(
      <Textarea
        aria-label="Notes"
        value="First line"
        onChange={onChange}
        onBlur={onBlur}
      />,
    );
    const textarea = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.change(textarea, {
      target: { value: "First line\nSecond line" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(textarea).toHaveValue("First line");
    rerender(
      <Textarea
        aria-label="Notes"
        value={"First line\nSecond line"}
        onChange={onChange}
        onBlur={onBlur}
      />,
    );
    expect(textarea).toHaveValue("First line\nSecond line");
    await userEvent.click(textarea);
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("preserves invalid state and descriptions without danger styling", () => {
    render(
      <>
        <Textarea
          aria-label="Rules"
          aria-invalid
          aria-describedby="rules-error"
        />
        <p id="rules-error">Use valid JSON</p>
      </>,
    );
    const textarea = screen.getByRole("textbox", { name: "Rules" });
    expect(textarea).toHaveAccessibleDescription("Use valid JSON");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea.className).not.toMatch(
      /state-danger|backdrop-blur|shadow-control/,
    );
    expect(textarea).not.toHaveClass("outline-none", "outline-hidden");
  });

  it("respects disabled and read-only native behavior", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Textarea
        aria-label="Notes"
        defaultValue="Original"
        disabled
        onChange={onChange}
      />,
    );
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "Changed");
    expect(textarea).toBeDisabled();
    rerender(
      <Textarea
        aria-label="Notes"
        defaultValue="Original"
        readOnly
        onChange={onChange}
      />,
    );
    await userEvent.type(textarea, "Changed");
    expect(textarea).toHaveAttribute("readonly");
    expect(textarea).toHaveValue("Original");
    expect(onChange).not.toHaveBeenCalled();
  });
});
