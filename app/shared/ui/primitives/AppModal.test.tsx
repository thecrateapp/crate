import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
} from "./AppModal";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AppModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <AppModal open={false} onClose={() => {}}>
        Content
      </AppModal>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders content when open", () => {
    render(
      <AppModal open onClose={() => {}}>
        Content
      </AppModal>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("portals the overlay to document.body", () => {
    const { container } = render(
      <div className="stacking-context">
        <AppModal open onClose={() => {}}>
          Portal content
        </AppModal>
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });

  it("calls onClose when overlay is clicked", async () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose}>
        Content
      </AppModal>,
    );
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on pointer down and ignores the follow-up click", () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose}>
        Content
      </AppModal>,
    );
    const overlay = screen.getByRole("dialog");
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("snaps back when dragged less than half the sheet height", () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose} mobileSafeArea>
        Content
      </AppModal>,
    );
    const dialog = screen.getByRole("dialog");
    const panel = dialog.querySelector("[tabindex='-1']") as HTMLElement;
    const handle = dialog.querySelector(".touch-pan-y") as HTMLElement;
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

    fireEvent.touchStart(handle, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 80 }] });
    fireEvent.touchEnd(panel);

    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("dismisses after dragging more than half the sheet height", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose} mobileSafeArea>
        Content
      </AppModal>,
    );
    const dialog = screen.getByRole("dialog");
    const panel = dialog.querySelector("[tabindex='-1']") as HTMLElement;
    const handle = dialog.querySelector(".touch-pan-y") as HTMLElement;
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

    fireEvent.touchStart(handle, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 140 }] });
    fireEvent.touchEnd(panel);
    vi.advanceTimersByTime(180);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when overlay click is disabled", async () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose} closeOnOverlay={false}>
        Content
      </AppModal>,
    );
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose}>
        Content
      </AppModal>,
    );
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when escape is disabled", () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose} closeOnEscape={false}>
        Content
      </AppModal>,
    );
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("applies custom maxWidthClassName", () => {
    render(
      <AppModal open onClose={() => {}} maxWidthClassName="max-w-4xl">
        Content
      </AppModal>,
    );
    expect(screen.getByText("Content")).toHaveClass("max-w-4xl");
  });
});

describe("ModalHeader", () => {
  it("renders children", () => {
    render(<ModalHeader>Title</ModalHeader>);
    expect(screen.getByText("Title")).toBeInTheDocument();
  });
});

describe("ModalBody", () => {
  it("renders children", () => {
    render(<ModalBody>Body content</ModalBody>);
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });
});

describe("ModalFooter", () => {
  it("renders children", () => {
    render(<ModalFooter>Actions</ModalFooter>);
    expect(screen.getByText("Actions")).toBeInTheDocument();
  });
});

describe("ModalCloseButton", () => {
  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<ModalCloseButton onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: /Close/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when disabled prop is true", () => {
    render(<ModalCloseButton onClick={() => {}} disabled />);
    expect(screen.getByRole("button", { name: /Close/i })).toBeDisabled();
  });
});
