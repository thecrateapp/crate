import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEscapeKey } from "./use-escape-key";

describe("useEscapeKey", () => {
  it("calls onEscape when Escape is pressed while active", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(true, onEscape));
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("does not call onEscape when inactive", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(false, onEscape));
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("does not call onEscape for other keys", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(true, onEscape));
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    window.dispatchEvent(event);
    expect(onEscape).not.toHaveBeenCalled();
  });
});
