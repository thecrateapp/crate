import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { useItemActionMenu } from "./useItemActionMenu";
import { useItemActionTarget } from "./useItemActionTarget";

let isDesktop = false;
let canHover = false;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => canHover,
}));

function Target({
  disabled = false,
  onClick = vi.fn(),
}: {
  disabled?: boolean;
  onClick?: () => void;
}) {
  const actionMenu = useItemActionMenu([], { hasActions: true });
  const target = useItemActionTarget(actionMenu, { disabled });
  return (
    <div
      role="row"
      tabIndex={0}
      data-testid="target"
      data-open={actionMenu.open}
      onClick={onClick}
      {...target}
    >
      Item
    </div>
  );
}

function isOpen() {
  return screen.getByTestId("target").getAttribute("data-open") === "true";
}

describe("useItemActionTarget", () => {
  beforeEach(() => {
    isDesktop = false;
    canHover = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the menu on contextmenu", () => {
    render(<Target />);
    fireEvent.contextMenu(screen.getByTestId("target"), {
      clientX: 10,
      clientY: 20,
    });
    expect(isOpen()).toBe(true);
  });

  it("opens the menu after a touch long-press and swallows the click", () => {
    const onClick = vi.fn();
    render(<Target onClick={onClick} />);
    const target = screen.getByTestId("target");

    fireEvent.pointerDown(target, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(target, { pointerType: "touch" });
    fireEvent.click(target);

    expect(isOpen()).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ignores mouse long-press", () => {
    render(<Target />);
    fireEvent.pointerDown(screen.getByTestId("target"), {
      pointerType: "mouse",
    });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(isOpen()).toBe(false);
  });

  it("opens the menu with the ContextMenu key", () => {
    render(<Target />);
    fireEvent.keyDown(screen.getByTestId("target"), { key: "ContextMenu" });
    expect(isOpen()).toBe(true);
  });

  it("opens the menu with Shift+F10", () => {
    render(<Target />);
    fireEvent.keyDown(screen.getByTestId("target"), {
      key: "F10",
      shiftKey: true,
    });
    expect(isOpen()).toBe(true);
  });

  it("ignores other keys", () => {
    render(<Target />);
    fireEvent.keyDown(screen.getByTestId("target"), { key: "F10" });
    fireEvent.keyDown(screen.getByTestId("target"), { key: "Enter" });
    expect(isOpen()).toBe(false);
  });

  it("does nothing when disabled", () => {
    render(<Target disabled />);
    const target = screen.getByTestId("target");
    fireEvent.contextMenu(target);
    fireEvent.keyDown(target, { key: "ContextMenu" });
    fireEvent.pointerDown(target, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(isOpen()).toBe(false);
  });
});
