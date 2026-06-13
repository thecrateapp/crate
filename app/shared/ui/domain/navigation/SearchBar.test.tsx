import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  it("calls onChange when typing", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <SearchBar value="" onChange={onChange} placeholder="Find music" />,
    );

    fireEvent.change(getByLabelText("Search"), {
      target: { value: "hello" },
    });

    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("calls onSubmit when pressing Enter", () => {
    const onSubmit = vi.fn();
    const { getByLabelText } = render(
      <SearchBar value="hello" onChange={vi.fn()} onSubmit={onSubmit} />,
    );

    fireEvent.keyDown(getByLabelText("Search"), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("calls onChange('') when clicking clear", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <SearchBar value="hello" onChange={onChange} />,
    );

    fireEvent.click(getByLabelText("Clear search"));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows loading spinner and hides clear while loading", () => {
    const { container, queryByLabelText } = render(
      <SearchBar value="hello" onChange={vi.fn()} loading />,
    );

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(queryByLabelText("Clear search")).not.toBeInTheDocument();
  });

  it("does not show clear when value is empty", () => {
    const { queryByLabelText } = render(
      <SearchBar value="" onChange={vi.fn()} />,
    );

    expect(queryByLabelText("Clear search")).not.toBeInTheDocument();
  });

  it("disables the input when disabled is true", () => {
    const { getByLabelText } = render(
      <SearchBar value="" onChange={vi.fn()} disabled />,
    );

    expect(getByLabelText("Search")).toBeDisabled();
  });

  it("focuses the input when autoFocus is true", () => {
    const { getByLabelText } = render(
      <SearchBar value="" onChange={vi.fn()} autoFocus />,
    );

    expect(getByLabelText("Search")).toHaveFocus();
  });

  it("calls onFocus and onBlur callbacks", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const { getByLabelText } = render(
      <SearchBar
        value=""
        onChange={vi.fn()}
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );

    fireEvent.focus(getByLabelText("Search"));
    expect(onFocus).toHaveBeenCalled();

    fireEvent.blur(getByLabelText("Search"));
    expect(onBlur).toHaveBeenCalled();
  });

  it("does not overlap loading and clear in the same right-side container", () => {
    const { container, queryByLabelText } = render(
      <SearchBar value="hello" onChange={vi.fn()} loading />,
    );

    const rightSlot = container.querySelector(
      ".absolute.right-4",
    ) as HTMLElement;
    expect(rightSlot).toBeInTheDocument();

    const buttons = rightSlot.querySelectorAll("button");
    expect(buttons.length).toBe(0);
    expect(queryByLabelText("Clear search")).not.toBeInTheDocument();
  });
});
