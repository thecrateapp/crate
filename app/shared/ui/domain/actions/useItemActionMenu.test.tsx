import { describe, expect, it, vi, beforeEach } from "vitest";
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
});
