import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ItemActionMenu, type ItemActionMenuEntry } from "./ItemActionMenu";

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => false,
}));

describe("ItemActionMenu mobile sheet", () => {
  it("stays above mobile player chrome and isolates action clicks", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const onOuterClick = vi.fn();
    const menuRef = createRef<HTMLDivElement>();
    const actions: ItemActionMenuEntry[] = [
      {
        key: "share",
        label: "Share track",
        onSelect,
      },
    ];

    render(
      <div onClick={onOuterClick}>
        <ItemActionMenu
          actions={actions}
          open
          position={null}
          menuRef={menuRef}
          onClose={onClose}
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveStyle({ zIndex: "1700" });
    expect(dialog.querySelector(".listen-glass-panel")).toHaveStyle({
      bottom:
        "calc(var(--listen-mobile-bottom-chrome-height, 4.75rem) + 0.75rem)",
    });

    await user.click(screen.getByRole("button", { name: /Share track/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOuterClick).not.toHaveBeenCalled();
  });

  it("closes on overlay tap and swallows the underlying click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const onOuterClick = vi.fn();
    const menuRef = createRef<HTMLDivElement>();
    const actions: ItemActionMenuEntry[] = [
      {
        key: "share",
        label: "Share track",
        onSelect,
      },
    ];

    render(
      <div className="min-h-screen" onClick={onOuterClick}>
        <ItemActionMenu
          actions={actions}
          open
          position={null}
          menuRef={menuRef}
          onClose={onClose}
        />
      </div>,
    );

    const overlay = screen.getByRole("dialog");
    await user.click(overlay);

    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOuterClick).not.toHaveBeenCalled();
  });
});
