import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AppModal } from "../primitives/AppModal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

const zIndexCss = readFileSync(
  resolve(process.cwd(), "tokens", "z-index.css"),
  "utf8",
);

function layerOf(element: Element | null): number {
  const layerClass = Array.from(element?.classList ?? []).find((name) =>
    name.startsWith("z-app-"),
  );
  const rule = zIndexCss.match(
    new RegExp(`\\.${layerClass}\\s*{\\s*z-index:\\s*var\\((--z-[a-z-]+)\\)`),
  );
  const value = zIndexCss.match(new RegExp(`${rule?.[1]}:\\s*(\\d+);`));
  return Number(value?.[1]);
}

function modalLayer() {
  return layerOf(document.querySelector("dialog"));
}

function expectAboveModal(content: Element | null) {
  const dialog = document.querySelector("dialog");
  expect(content).not.toBeNull();
  expect(dialog?.contains(content)).toBe(false);
  expect(layerOf(content)).toBeGreaterThan(modalLayer());
}

describe("floating layers inside AppModal", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders select content above the modal", () => {
    render(
      <AppModal open onClose={vi.fn()} title="Edit crate">
        <Select open defaultValue="private">
          <SelectTrigger aria-label="Visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">Private</SelectItem>
          </SelectContent>
        </Select>
      </AppModal>,
    );

    expectAboveModal(document.querySelector('[data-slot="select-content"]'));
  });

  it("renders dropdown menu content above the modal and dismisses only the menu on Escape", () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose} title="Edit crate">
        <DropdownMenu open>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Rename</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </AppModal>,
    );

    expectAboveModal(
      document.querySelector('[data-slot="dropdown-menu-content"]'),
    );

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(["popover", "dropdown"] as const)(
    "renders %s-layer popover content above the modal",
    (layer) => {
      const onClose = vi.fn();
      render(
        <AppModal open onClose={onClose} title="Edit crate">
          <Popover open>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent layer={layer}>Popover body</PopoverContent>
          </Popover>
        </AppModal>,
      );

      const content = document.querySelector('[data-slot="popover-content"]');
      expectAboveModal(content);

      fireEvent.keyDown(content!, { key: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("renders tooltip content above the modal", () => {
    render(
      <AppModal open onClose={vi.fn()} title="Edit crate">
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Hint</TooltipTrigger>
            <TooltipContent>Tooltip body</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </AppModal>,
    );

    expectAboveModal(document.querySelector('[data-slot="tooltip-content"]'));
  });

  it("renders context menu content above the modal", () => {
    render(
      <AppModal open onClose={vi.fn()} title="Edit crate">
        <ContextMenu>
          <ContextMenuTrigger>Album row</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Remove</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </AppModal>,
    );

    fireEvent.contextMenu(screen.getByText("Album row"));

    expectAboveModal(
      document.querySelector('[data-slot="context-menu-content"]'),
    );
  });

  it("renders popover content above a shadcn Dialog", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>Role</DialogDescription>
          <Popover open>
            <PopoverTrigger>Role</PopoverTrigger>
            <PopoverContent layer="dropdown">Admin</PopoverContent>
          </Popover>
        </DialogContent>
      </Dialog>,
    );

    const dialogContent = document.querySelector(
      '[data-slot="dialog-content"]',
    );
    const content = document.querySelector('[data-slot="popover-content"]');

    expect(dialogContent?.contains(content)).toBe(false);
    expect(layerOf(content)).toBeGreaterThan(layerOf(dialogContent));
  });
});
