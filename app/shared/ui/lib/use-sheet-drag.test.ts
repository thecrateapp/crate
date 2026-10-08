import { createElement, useRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getScrollableAncestor,
  useSheetDrag,
  type UseSheetDragReturn,
} from "./use-sheet-drag";

afterEach(() => {
  vi.restoreAllMocks();
});

const rect = (height: number) => ({
  bottom: height,
  height,
  left: 0,
  right: 320,
  top: 0,
  width: 320,
  x: 0,
  y: 0,
  toJSON: () => {},
});

function setup({
  enabled = true,
  height = 200,
}: { enabled?: boolean; height?: number } = {}) {
  const onDismiss = vi.fn();
  const onDragStart = vi.fn();
  const state: { current: UseSheetDragReturn | null } = { current: null };

  function Harness() {
    const panelRef = useRef<HTMLDivElement>(null);
    const drag = useSheetDrag({ panelRef, enabled, onDismiss, onDragStart });
    state.current = drag;
    return createElement(
      "div",
      {
        ref: panelRef,
        "data-testid": "panel",
        style: { transform: drag.swipeY ? `translateY(${drag.swipeY}px)` : "" },
      },
      createElement("div", {
        ref: drag.dragHandleRef,
        "data-testid": "handle",
        ...drag.dragHandleProps,
      }),
      createElement(
        "div",
        { "data-testid": "scroller", style: { overflowY: "auto" } },
        createElement("p", { "data-testid": "row" }, "Row"),
      ),
    );
  }

  const utils = render(createElement(Harness));
  const panel = utils.getByTestId("panel");
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect(height));
  return { ...utils, panel, onDismiss, onDragStart, state };
}

describe("useSheetDrag", () => {
  it("ignores touch movement below the activation threshold", () => {
    const { panel, getByTestId, onDragStart, state } = setup();

    fireEvent.touchStart(getByTestId("handle"), { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 8 }] });

    expect(onDragStart).not.toHaveBeenCalled();
    expect(state.current?.isDragging).toBe(false);
    expect(state.current?.swipeY).toBe(0);
  });

  it("tracks the drag offset and snaps back below half the panel height", () => {
    const { panel, getByTestId, onDismiss, onDragStart, state } = setup();

    fireEvent.touchStart(getByTestId("handle"), { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 60 }] });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(state.current?.isDragging).toBe(true);
    expect(state.current?.swipeY).toBe(60);

    fireEvent.touchEnd(panel);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(state.current?.isDragging).toBe(false);
    expect(state.current?.swipeY).toBe(0);
  });

  it("dismisses once the drag passes half the panel height", () => {
    const { panel, getByTestId, onDismiss } = setup();

    fireEvent.touchStart(getByTestId("handle"), { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 120 }] });
    fireEvent.touchEnd(panel);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clamps the offset to the panel height plus overshoot", () => {
    const { panel, getByTestId, state } = setup();

    fireEvent.touchStart(getByTestId("handle"), { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 900 }] });

    expect(state.current?.swipeY).toBe(224);
    expect(state.current?.getDismissOffset()).toBe(224);
  });

  it("does not start from content that is scrolled down", () => {
    const { panel, getByTestId, onDragStart } = setup();
    const scroller = getByTestId("scroller");
    Object.defineProperty(scroller, "scrollHeight", { value: 500 });
    Object.defineProperty(scroller, "clientHeight", { value: 100 });
    scroller.scrollTop = 40;

    fireEvent.touchStart(getByTestId("row"), { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 120 }] });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("supports pointer dragging from the handle", () => {
    const { getByTestId, onDismiss } = setup();
    const handle = getByTestId("handle");

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 0,
      pointerId: 3,
      pointerType: "touch",
    });
    fireEvent.pointerMove(handle, { clientY: 150, pointerId: 3 });
    fireEvent.pointerUp(handle, { clientY: 150, pointerId: 3 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores secondary mouse buttons and foreign pointers", () => {
    const { getByTestId, onDragStart, state } = setup();
    const handle = getByTestId("handle");

    fireEvent.pointerDown(handle, {
      button: 2,
      clientY: 0,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(onDragStart).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 0,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(handle, { clientY: 150, pointerId: 9 });
    expect(state.current?.swipeY).toBe(0);
  });

  it("resets on touch cancel", () => {
    const { panel, getByTestId, onDismiss, state } = setup();

    fireEvent.touchStart(getByTestId("handle"), { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 150 }] });
    fireEvent.touchCancel(panel);
    fireEvent.touchEnd(panel);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(state.current?.swipeY).toBe(0);
    expect(state.current?.isDragging).toBe(false);
  });

  it("does not listen for touches while disabled", () => {
    const { panel, getByTestId, onDragStart } = setup({ enabled: false });

    fireEvent.touchStart(getByTestId("handle"), { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 150 }] });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("exposes resetDrag for consumers", () => {
    const { panel, getByTestId, state } = setup();

    fireEvent.touchStart(getByTestId("handle"), { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 60 }] });
    act(() => {
      state.current?.resetDrag();
    });

    expect(state.current?.swipeY).toBe(0);
    expect(state.current?.isDragging).toBe(false);
  });
});

describe("getScrollableAncestor", () => {
  it("returns null outside scroll containers", () => {
    const boundary = document.createElement("div");
    const child = document.createElement("span");
    boundary.appendChild(child);
    document.body.appendChild(boundary);

    expect(getScrollableAncestor(child, boundary)).toBeNull();
    expect(getScrollableAncestor(null, boundary)).toBeNull();
    boundary.remove();
  });
});
