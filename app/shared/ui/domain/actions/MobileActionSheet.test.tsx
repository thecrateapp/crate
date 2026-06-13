import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileActionSheet } from "./MobileActionSheet";

afterEach(() => {
  vi.useRealTimers();
});

describe("MobileActionSheet", () => {
  it("renders role=dialog when open", () => {
    render(
      <MobileActionSheet open onClose={vi.fn()}>
        <div data-testid="child">Content</div>
      </MobileActionSheet>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("child")).toHaveTextContent("Content");
  });

  it("unmounts after close timers complete", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const panelRef = createRef<HTMLDivElement>();
    const { rerender } = render(
      <MobileActionSheet open onClose={onClose} panelRef={panelRef}>
        <div>Content</div>
      </MobileActionSheet>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => {
      rerender(
        <MobileActionSheet open={false} onClose={onClose} panelRef={panelRef}>
          <div>Content</div>
        </MobileActionSheet>,
      );
    });

    act(() => {
      vi.advanceTimersByTime(180);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("calls onClose when overlay is clicked", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const panelRef = createRef<HTMLDivElement>();
    render(
      <MobileActionSheet open onClose={onClose} panelRef={panelRef}>
        <div>Content</div>
      </MobileActionSheet>,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);

    act(() => {
      vi.advanceTimersByTime(140);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not call onClose when panel content is clicked", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const panelRef = createRef<HTMLDivElement>();
    render(
      <MobileActionSheet open onClose={onClose} panelRef={panelRef}>
        <button data-testid="inside">Inside</button>
      </MobileActionSheet>,
    );

    fireEvent.click(screen.getByTestId("inside"));

    act(() => {
      vi.advanceTimersByTime(140);
    });

    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not close when panel content is clicked without an external panelRef", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <MobileActionSheet open onClose={onClose}>
        <button data-testid="inside">Inside</button>
      </MobileActionSheet>,
    );

    fireEvent.click(screen.getByTestId("inside"));

    act(() => {
      vi.advanceTimersByTime(140);
    });

    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("uses a non-scroll touch target for the drag handle", () => {
    render(
      <MobileActionSheet open onClose={vi.fn()}>
        <div>Content</div>
      </MobileActionSheet>,
    );

    const handle = screen
      .getByRole("dialog")
      .querySelector("[data-mobile-sheet-drag-handle='true']");

    expect(handle).toHaveClass("touch-none");
    expect(handle).not.toHaveClass("touch-pan-y");
  });

  it("calls onClose when dragged down with pointer events", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const panelRef = createRef<HTMLDivElement>();
    render(
      <MobileActionSheet open onClose={onClose} panelRef={panelRef}>
        <div>Content</div>
      </MobileActionSheet>,
    );

    const dialog = screen.getByRole("dialog");
    const panel = dialog.querySelector(".listen-glass-panel") as HTMLElement;
    const handle = panel.querySelector(
      "[data-mobile-sheet-drag-handle='true']",
    ) as HTMLElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      bottom: 240,
      height: 200,
      left: 0,
      right: 320,
      top: 40,
      width: 320,
      x: 0,
      y: 40,
      toJSON: () => {},
    });

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 0,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerMove(handle, {
      clientY: 140,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(handle, {
      clientY: 140,
      pointerId: 1,
      pointerType: "touch",
    });

    act(() => {
      vi.advanceTimersByTime(180);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("calls onClose when dragged down from sheet content at the top", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const panelRef = createRef<HTMLDivElement>();
    render(
      <MobileActionSheet open onClose={onClose} panelRef={panelRef}>
        <div data-testid="sheet-content">Content</div>
      </MobileActionSheet>,
    );

    const panel = screen
      .getByRole("dialog")
      .querySelector(".listen-glass-panel") as HTMLElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      bottom: 240,
      height: 200,
      left: 0,
      right: 320,
      top: 40,
      width: 320,
      x: 0,
      y: 40,
      toJSON: () => {},
    });

    fireEvent.touchStart(screen.getByTestId("sheet-content"), {
      touches: [{ clientY: 80 }],
    });
    fireEvent.touchMove(panel, { touches: [{ clientY: 220 }] });
    fireEvent.touchEnd(panel);

    act(() => {
      vi.advanceTimersByTime(180);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("removes the entrance animation while dragging so the drag transform wins", () => {
    const onClose = vi.fn();
    const panelRef = createRef<HTMLDivElement>();
    render(
      <MobileActionSheet open onClose={onClose} panelRef={panelRef}>
        <div data-testid="sheet-content">Content</div>
      </MobileActionSheet>,
    );

    const panel = screen
      .getByRole("dialog")
      .querySelector(".listen-glass-panel") as HTMLElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      bottom: 240,
      height: 200,
      left: 0,
      right: 320,
      top: 40,
      width: 320,
      x: 0,
      y: 40,
      toJSON: () => {},
    });

    fireEvent.touchStart(screen.getByTestId("sheet-content"), {
      touches: [{ clientY: 80 }],
    });
    fireEvent.touchMove(panel, { touches: [{ clientY: 120 }] });

    expect(panel).toHaveStyle({ transform: "translateY(40px)" });
    expect(panel).not.toHaveClass("animate-sheet-up");
  });
});
