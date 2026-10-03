import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useItemActionMenu } from "./useItemActionMenu";

let isDesktop = false;
let canHover = true;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => canHover,
}));

function createMouseEvent<T extends HTMLElement>(
  clientX: number,
  clientY: number,
): React.MouseEvent<T> {
  return {
    clientX,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: document.createElement("div"),
  } as unknown as React.MouseEvent<T>;
}

function createButtonMouseEvent(
  rect: DOMRect,
): React.MouseEvent<HTMLButtonElement> {
  const button = document.createElement("button");
  button.getBoundingClientRect = () => rect;
  return {
    currentTarget: button,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLButtonElement>;
}

describe("useItemActionMenu", () => {
  beforeEach(() => {
    isDesktop = false;
    canHover = true;
  });

  it("starts closed and reports hasActions", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );

    expect(result.current.open).toBe(false);
    expect(result.current.hasActions).toBe(true);
    expect(result.current.position).toBeNull();
    expect(result.current.measured).toBe(false);
  });

  it("reports hasActions=false when only dividers and labels are provided", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([
        { type: "label", key: "l", label: "L" },
        { type: "divider", key: "d" },
      ]),
    );

    expect(result.current.hasActions).toBe(false);
  });

  it("opens from trigger using currentTarget bounding rect", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );

    act(() => {
      result.current.openFromTrigger(
        createButtonMouseEvent({
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          top: 0,
          right: 100,
          bottom: 40,
          left: 0,
          toJSON: () => {},
        }),
      );
    });

    expect(result.current.open).toBe(true);
    expect(result.current.position).toEqual({ x: 92, y: 48 });
  });

  it("aligns a right-edge menu to the trigger without overflowing the viewport", () => {
    isDesktop = true;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 768,
    });
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }], {
        placement: "bottom-end",
      }),
    );
    const menu = document.createElement("div");
    menu.getBoundingClientRect = () => ({ width: 288, height: 200 }) as DOMRect;
    result.current.menuRef.current = menu;

    act(() => {
      result.current.openFromTrigger(
        createButtonMouseEvent({
          x: 0,
          y: 0,
          width: 40,
          height: 40,
          top: 120,
          right: 1000,
          bottom: 160,
          left: 960,
          toJSON: () => {},
        }),
      );
    });

    expect(result.current.position).toEqual({ x: 712, y: 168 });
  });

  it("toggles closed when trigger is clicked while open", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );

    act(() => {
      result.current.openFromTrigger(
        createButtonMouseEvent({
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          top: 0,
          right: 100,
          bottom: 40,
          left: 0,
          toJSON: () => {},
        }),
      );
    });

    expect(result.current.open).toBe(true);

    act(() => {
      result.current.openFromTrigger(
        createButtonMouseEvent({
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          top: 0,
          right: 100,
          bottom: 40,
          left: 0,
          toJSON: () => {},
        }),
      );
    });

    expect(result.current.open).toBe(false);
  });

  it("opens at pointer coordinates on context menu event", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );

    act(() => {
      result.current.handleContextMenu(createMouseEvent<HTMLElement>(100, 200));
    });

    expect(result.current.open).toBe(true);
    expect(result.current.position).toEqual({ x: 104, y: 204 });
  });

  it("opens on ContextMenu key", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );

    const target = document.createElement("div");
    target.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 20,
        width: 100,
        height: 40,
        top: 20,
        right: 110,
        bottom: 60,
        left: 10,
        toJSON: () => {},
      }) as DOMRect;

    act(() => {
      result.current.handleKeyboardTrigger({
        key: "ContextMenu",
        currentTarget: target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        shiftKey: false,
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.position).toEqual({ x: 102, y: 68 });
  });

  it("opens on Shift+F10", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );

    const target = document.createElement("div");
    target.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        top: 0,
        right: 100,
        bottom: 40,
        left: 0,
        toJSON: () => {},
      }) as DOMRect;

    act(() => {
      result.current.handleKeyboardTrigger({
        key: "F10",
        shiftKey: true,
        currentTarget: target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });

    expect(result.current.open).toBe(true);
  });

  it("ignores unrelated keyboard events", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );

    act(() => {
      result.current.handleKeyboardTrigger({
        key: "Enter",
        shiftKey: false,
        currentTarget: document.createElement("div"),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });

    expect(result.current.open).toBe(false);
  });

  it("does not open when disabled", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }], {
        disabled: true,
      }),
    );

    act(() => {
      result.current.handleContextMenu(createMouseEvent<HTMLElement>(10, 20));
    });

    expect(result.current.open).toBe(false);
  });

  it("closes and resets state", () => {
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );

    act(() => {
      result.current.openFromTrigger(
        createButtonMouseEvent({
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          top: 0,
          right: 100,
          bottom: 40,
          left: 0,
          toJSON: () => {},
        }),
      );
    });

    act(() => {
      result.current.close();
    });

    expect(result.current.open).toBe(false);
    expect(result.current.position).toBeNull();
    expect(result.current.measured).toBe(false);
  });

  it("reports isDesktop from useIsDesktop", () => {
    isDesktop = true;
    const { result } = renderHook(() =>
      useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
    );
    expect(result.current.isDesktop).toBe(true);
  });

  describe("long press", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function createPointerEvent(
      pointerType: string,
      clientX = 10,
      clientY = 10,
    ): React.PointerEvent<HTMLElement> {
      const target = document.createElement("div");
      target.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 100, height: 40 }) as DOMRect;
      return {
        pointerType,
        clientX,
        clientY,
        currentTarget: target,
      } as unknown as React.PointerEvent<HTMLElement>;
    }

    function renderTouchMenu() {
      canHover = false;
      return renderHook(() =>
        useItemActionMenu([{ key: "a", label: "A", onSelect: vi.fn() }]),
      );
    }

    it("opens after a stationary touch press", () => {
      const { result } = renderTouchMenu();

      act(() => {
        result.current.longPressHandlers.onPointerDown(
          createPointerEvent("touch"),
        );
        vi.advanceTimersByTime(420);
      });

      expect(result.current.open).toBe(true);
    });

    it("cancels the press when the pointer moves past the threshold", () => {
      const { result } = renderTouchMenu();

      act(() => {
        result.current.longPressHandlers.onPointerDown(
          createPointerEvent("touch", 10, 10),
        );
        result.current.longPressHandlers.onPointerMove(
          createPointerEvent("touch", 10, 24),
        );
        vi.advanceTimersByTime(420);
      });

      expect(result.current.open).toBe(false);
    });

    it("keeps the press alive for small jitter", () => {
      const { result } = renderTouchMenu();

      act(() => {
        result.current.longPressHandlers.onPointerDown(
          createPointerEvent("touch", 10, 10),
        );
        result.current.longPressHandlers.onPointerMove(
          createPointerEvent("touch", 14, 13),
        );
        vi.advanceTimersByTime(420);
      });

      expect(result.current.open).toBe(true);
    });

    it("does not swallow the next mouse click after a touch long press", () => {
      const { result } = renderTouchMenu();

      act(() => {
        result.current.longPressHandlers.onPointerDown(
          createPointerEvent("touch"),
        );
        vi.advanceTimersByTime(420);
      });
      act(() => {
        result.current.close();
        result.current.longPressHandlers.onPointerDown(
          createPointerEvent("mouse"),
        );
      });

      const click = createMouseEvent<HTMLElement>(0, 0);
      result.current.longPressHandlers.onClickCapture(click);

      expect(click.preventDefault).not.toHaveBeenCalled();
    });

    function createTargetedClick(target: Node): React.MouseEvent<HTMLElement> {
      return {
        target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLElement>;
    }

    it("lets taps inside the open menu through after a long press", () => {
      const { result } = renderTouchMenu();
      const menu = document.createElement("div");
      const item = document.createElement("button");
      menu.appendChild(item);

      act(() => {
        result.current.longPressHandlers.onPointerDown(
          createPointerEvent("touch"),
        );
        vi.advanceTimersByTime(420);
      });
      result.current.menuRef.current = menu;

      const itemClick = createTargetedClick(item);
      result.current.longPressHandlers.onClickCapture(itemClick);
      expect(itemClick.preventDefault).not.toHaveBeenCalled();
      expect(itemClick.stopPropagation).not.toHaveBeenCalled();

      const rowClick = createTargetedClick(document.createElement("div"));
      result.current.longPressHandlers.onClickCapture(rowClick);
      expect(rowClick.preventDefault).not.toHaveBeenCalled();
    });

    it("still swallows the long-press ghost click outside the menu", () => {
      const { result } = renderTouchMenu();

      act(() => {
        result.current.longPressHandlers.onPointerDown(
          createPointerEvent("touch"),
        );
        vi.advanceTimersByTime(420);
      });

      const ghostClick = createTargetedClick(document.createElement("div"));
      result.current.longPressHandlers.onClickCapture(ghostClick);
      expect(ghostClick.preventDefault).toHaveBeenCalled();
      expect(ghostClick.stopPropagation).toHaveBeenCalled();
    });

    it("resets the long-press flag when the menu closes without a click", () => {
      const { result } = renderTouchMenu();

      act(() => {
        result.current.longPressHandlers.onPointerDown(
          createPointerEvent("touch"),
        );
        vi.advanceTimersByTime(420);
      });
      act(() => {
        result.current.close();
      });

      const nextClick = createTargetedClick(document.createElement("div"));
      result.current.longPressHandlers.onClickCapture(nextClick);
      expect(nextClick.preventDefault).not.toHaveBeenCalled();
    });
  });
});
