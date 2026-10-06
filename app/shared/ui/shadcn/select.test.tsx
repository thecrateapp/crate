import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AppModal } from "../primitives/AppModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

function ModalSelect({ onClose = vi.fn() }: { onClose?: () => void }) {
  return (
    <AppModal open onClose={onClose} title="Edit crate">
      <Select open defaultValue="private">
        <SelectTrigger aria-label="Visibility">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="private">Private</SelectItem>
          <SelectItem value="public">Public</SelectItem>
        </SelectContent>
      </Select>
    </AppModal>
  );
}

describe("Select", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("layers its portalled content above an open AppModal", () => {
    render(<ModalSelect />);

    const dialog = document.querySelector("dialog");
    const content = document.querySelector('[data-slot="select-content"]');

    expect(dialog).toHaveClass("z-app-modal");
    expect(content).toHaveClass("z-app-dropdown");
    expect(dialog?.contains(content)).toBe(false);
  });

  it("dismisses only the select when Escape is pressed inside a modal", () => {
    const onClose = vi.fn();
    render(<ModalSelect onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});
