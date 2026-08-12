import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useContextMenuController } from "./useContextMenuController";

let isDesktop = true;
let canHover = true;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => canHover,
}));

describe("useContextMenuController", () => {
  beforeEach(() => {
    isDesktop = true;
    canHover = true;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 768,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
  });

  it("opens from a point and closes when the viewport scrolls", () => {
    const { result } = renderHook(() => useContextMenuController());

    act(() => {
      result.current.openAtPoint(120, 240);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.position).toEqual({ x: 120, y: 240 });

    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.open).toBe(false);
    expect(result.current.position).toBeNull();
  });

  it("flips an anchored menu above the trigger when there is no room below", () => {
    const { result } = renderHook(() =>
      useContextMenuController<HTMLButtonElement>({ placement: "bottom-end" }),
    );
    const menu = document.createElement("div");
    menu.getBoundingClientRect = () =>
      ({
        width: 288,
        height: 300,
        top: 0,
        right: 0,
        bottom: 300,
        left: 0,
      }) as DOMRect;
    result.current.menuRef.current = menu;

    act(() => {
      result.current.openFromTrigger({
        currentTarget: Object.assign(document.createElement("button"), {
          getBoundingClientRect: () =>
            ({
              top: 700,
              right: 900,
              bottom: 740,
              left: 860,
              width: 40,
              height: 40,
            }) as DOMRect,
        }),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLButtonElement>);
    });

    expect(result.current.position).toEqual({ x: 612, y: 392 });
  });

  it("flips a point-open menu above the pointer when it would be cut off", () => {
    const { result } = renderHook(() => useContextMenuController());
    const menu = document.createElement("div");
    menu.getBoundingClientRect = () => ({ width: 288, height: 300 }) as DOMRect;
    result.current.menuRef.current = menu;

    act(() => {
      result.current.openAtPoint(700, 600);
    });

    expect(result.current.position).toEqual({ x: 700, y: 296 });
  });

  it("clamps to the visible document width when the browser scrollbar reduces it", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 900,
    });
    const { result } = renderHook(() =>
      useContextMenuController<HTMLButtonElement>({ placement: "bottom-end" }),
    );
    const menu = document.createElement("div");
    menu.getBoundingClientRect = () => ({ width: 288, height: 200 }) as DOMRect;
    result.current.menuRef.current = menu;

    act(() => {
      result.current.openFromTrigger({
        currentTarget: Object.assign(document.createElement("button"), {
          getBoundingClientRect: () =>
            ({ top: 120, right: 1000, bottom: 160 }) as DOMRect,
        }),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLButtonElement>);
    });

    expect(result.current.position).toEqual({ x: 600, y: 168 });
  });

  it("does not manage dismissal when the owner delegates it", () => {
    const { result } = renderHook(() =>
      useContextMenuController({ manageDismissal: false }),
    );

    act(() => {
      result.current.openAtPoint(120, 240);
      document.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.open).toBe(true);
  });
});
