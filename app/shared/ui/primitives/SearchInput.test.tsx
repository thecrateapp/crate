import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchInput } from "./SearchInput";

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchInput", () => {
  it("renders a labelled searchbox with English defaults", () => {
    render(<SearchInput />);
    expect(
      screen.getByRole("searchbox", { name: "Search" }),
    ).toBeInTheDocument();
  });

  it("debounces onDebouncedChange", () => {
    vi.useFakeTimers();
    const onDebouncedChange = vi.fn();
    render(
      <SearchInput debounceMs={200} onDebouncedChange={onDebouncedChange} />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "bi" } });
    fireEvent.change(input, { target: { value: "birds" } });
    act(() => vi.advanceTimersByTime(199));
    expect(onDebouncedChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDebouncedChange).toHaveBeenCalledTimes(1);
    expect(onDebouncedChange).toHaveBeenCalledWith("birds");
  });

  it("does not emit on mount", () => {
    vi.useFakeTimers();
    const onDebouncedChange = vi.fn();
    render(
      <SearchInput defaultValue="x" onDebouncedChange={onDebouncedChange} />,
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(onDebouncedChange).not.toHaveBeenCalled();
  });

  it("clears immediately and focuses the input", async () => {
    const onDebouncedChange = vi.fn();
    const onClear = vi.fn();
    render(
      <SearchInput
        defaultValue="rival"
        clearLabel="Borrar"
        onClear={onClear}
        onDebouncedChange={onDebouncedChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Borrar" }));
    const input = screen.getByRole("searchbox");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onDebouncedChange).toHaveBeenCalledWith("");
    expect(
      screen.queryByRole("button", { name: "Borrar" }),
    ).not.toBeInTheDocument();
  });

  it("emits the previous debounced value when retyped quickly after clearing", () => {
    vi.useFakeTimers();
    const onDebouncedChange = vi.fn();
    render(
      <SearchInput debounceMs={200} onDebouncedChange={onDebouncedChange} />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "rival" } });
    act(() => vi.advanceTimersByTime(200));
    expect(onDebouncedChange).toHaveBeenLastCalledWith("rival");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onDebouncedChange).toHaveBeenLastCalledWith("");

    act(() => vi.advanceTimersByTime(50));
    fireEvent.change(input, { target: { value: "rival" } });
    act(() => vi.advanceTimersByTime(200));
    expect(onDebouncedChange).toHaveBeenLastCalledWith("rival");
    expect(onDebouncedChange).toHaveBeenCalledTimes(3);
  });

  it("hides the clear button when not clearable", () => {
    render(<SearchInput defaultValue="x" clearable={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("works controlled", async () => {
    function Controlled() {
      const [value, setValue] = useState("");
      return (
        <>
          <SearchInput label="Find" value={value} onValueChange={setValue} />
          <output>{value}</output>
        </>
      );
    }
    render(<Controlled />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Find" }), "hv");
    expect(screen.getByRole("status")).toHaveTextContent("hv");
  });

  it("forwards refs and native onChange", () => {
    const ref = { current: null as HTMLInputElement | null };
    const onChange = vi.fn();
    render(<SearchInput ref={ref} onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "a" } });
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
