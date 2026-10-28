import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Card } from "./card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

describe("semantic surface shadows", () => {
  it("keeps approved cards flat with their solid surface and hairline border", () => {
    render(<Card>Card content</Card>);

    expect(screen.getByText("Card content")).toHaveClass(
      "border",
      "border-border-quiet",
      "bg-surface-object",
    );
    expect(screen.getByText("Card content")).not.toHaveClass("shadow-card");
  });

  it("uses the shared overlay recipe for select content", () => {
    render(
      <Select open defaultValue="one">
        <SelectTrigger aria-label="Select value" />
        <SelectContent>
          <SelectItem value="one">One</SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(document.querySelector('[data-slot="select-content"]')).toHaveClass(
      "crate-overlay-surface",
    );
  });

  it("uses the shared overlay recipe for modal content", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          Dialog content
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog")).toHaveClass("crate-overlay-panel");
    expect(screen.getByRole("dialog")).not.toHaveClass("shadow-modal");
  });

  it("uses the shared overlay recipe for sheet content", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
          Sheet content
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole("dialog")).toHaveClass("crate-overlay-panel");
    expect(screen.getByRole("dialog")).not.toHaveClass("shadow-sheet");
  });
});
