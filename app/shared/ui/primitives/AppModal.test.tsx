import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
} from "./AppModal";

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
