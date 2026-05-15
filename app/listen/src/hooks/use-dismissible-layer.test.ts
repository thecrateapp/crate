import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDismissibleLayer } from "./use-dismissible-layer";

describe("useDismissibleLayer", () => {
  it("calls onDismiss when clicking outside", () => {
    const onDismiss = vi.fn();
    const ref = { current: document.createElement("div") };
    document.body.appendChild(ref.current);

    renderHook(() =>
      useDismissibleLayer({
        active: true,
        refs: [ref],
        onDismiss,
      }),
    );

    const event = new MouseEvent("mousedown", { bubbles: true });
    document.body.dispatchEvent(event);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.body.removeChild(ref.current);
  });

  it("does not call onDismiss when clicking inside", () => {
    const onDismiss = vi.fn();
    const ref = { current: document.createElement("div") };
    document.body.appendChild(ref.current);

    renderHook(() =>
      useDismissibleLayer({
        active: true,
        refs: [ref],
        onDismiss,
      }),
    );

    const event = new MouseEvent("mousedown", { bubbles: true });
    ref.current.dispatchEvent(event);
    expect(onDismiss).not.toHaveBeenCalled();

    document.body.removeChild(ref.current);
  });

  it("calls onDismiss when Escape is pressed", () => {
    const onDismiss = vi.fn();
    renderHook(() =>
      useDismissibleLayer({
        active: true,
        refs: [],
        onDismiss,
      }),
    );

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not call onDismiss when inactive", () => {
    const onDismiss = vi.fn();
    renderHook(() =>
      useDismissibleLayer({
        active: false,
        refs: [],
        onDismiss,
      }),
    );

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
