import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboard } from "./use-keyboard";

describe("useKeyboard", () => {
  it("calls onFocusSearch when / is pressed outside input", () => {
    const onFocusSearch = vi.fn();
    renderHook(() =>
      useKeyboard({
        onFocusSearch,
        onBlurSearch: vi.fn(),
        onShowHelp: vi.fn(),
      }),
    );
    const event = new KeyboardEvent("keydown", { key: "/" });
    document.dispatchEvent(event);
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });

  it("calls onBlurSearch when Escape is pressed", () => {
    const onBlurSearch = vi.fn();
    renderHook(() =>
      useKeyboard({
        onFocusSearch: vi.fn(),
        onBlurSearch,
        onShowHelp: vi.fn(),
      }),
    );
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(event);
    expect(onBlurSearch).toHaveBeenCalledTimes(1);
  });

  it("calls onShowHelp when ? is pressed outside input", () => {
    const onShowHelp = vi.fn();
    renderHook(() =>
      useKeyboard({
        onFocusSearch: vi.fn(),
        onBlurSearch: vi.fn(),
        onShowHelp,
      }),
    );
    const event = new KeyboardEvent("keydown", { key: "?" });
    document.dispatchEvent(event);
    expect(onShowHelp).toHaveBeenCalledTimes(1);
  });

  it("does not call onFocusSearch when / is pressed inside input", () => {
    const onFocusSearch = vi.fn();
    renderHook(() =>
      useKeyboard({
        onFocusSearch,
        onBlurSearch: vi.fn(),
        onShowHelp: vi.fn(),
      }),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true });
    input.dispatchEvent(event);
    expect(onFocusSearch).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
