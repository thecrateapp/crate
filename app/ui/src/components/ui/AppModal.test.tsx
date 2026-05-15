import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AppModal,
  ModalBody,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";

describe("AppModal", () => {
  it("renders when open and hides children when closed", () => {
    const { rerender } = render(
      <AppModal open={false} onClose={vi.fn()}>
        <ModalHeader>Title</ModalHeader>
        <ModalBody>Content</ModalBody>
      </AppModal>,
    );
    expect(screen.queryByText("Title")).not.toBeInTheDocument();

    rerender(
      <AppModal open onClose={vi.fn()}>
        <ModalHeader>Title</ModalHeader>
        <ModalBody>Content</ModalBody>
      </AppModal>,
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("calls onClose when overlay is clicked", () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose}>
        <ModalBody>Content</ModalBody>
      </AppModal>,
    );
    const overlay = screen.getByRole("dialog");
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies mobile safe-area classes when mobileSafeArea is true", () => {
    render(
      <AppModal open onClose={vi.fn()} mobileSafeArea>
        <ModalBody>Content</ModalBody>
      </AppModal>,
    );
    const panel = screen.getByText("Content").parentElement;
    expect(panel?.className).toContain("pb-[var(--listen-safe-bottom)]");
    expect(panel?.className).toContain("sm:pb-0");
  });

  it("does not apply mobile safe-area classes by default", () => {
    render(
      <AppModal open onClose={vi.fn()}>
        <ModalBody>Content</ModalBody>
      </AppModal>,
    );
    const panel = screen.getByText("Content").parentElement;
    expect(panel?.className).not.toContain("pb-[var(--listen-safe-bottom)]");
  });
});
