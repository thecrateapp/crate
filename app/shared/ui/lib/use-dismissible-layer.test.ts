import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

    document.body.dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true }),
    );
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

    ref.current.dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(onDismiss).not.toHaveBeenCalled();

    document.body.removeChild(ref.current);
  });

  it("suppresses the synthetic click after an outside pointer dismiss", () => {
    const onDismiss = vi.fn();
    const onUnderlyingClick = vi.fn();
    const ref = { current: document.createElement("div") };
    const target = document.createElement("button");
    target.addEventListener("click", onUnderlyingClick);
    document.body.appendChild(ref.current);
    document.body.appendChild(target);

    renderHook(() =>
      useDismissibleLayer({
        active: true,
        refs: [ref],
        onDismiss,
      }),
    );

    target.dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUnderlyingClick).not.toHaveBeenCalled();

    document.body.removeChild(ref.current);
    document.body.removeChild(target);
  });
});
