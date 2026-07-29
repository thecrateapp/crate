import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContextMenu,
  ItemActionMenu,
  type ItemActionMenuEntry,
} from "@/components/actions/ItemActionMenu";

let isDesktop = false;
let canHover = true;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => canHover,
}));

function mockNonTouchPointerEnvironment() {
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(navigator, "userAgent", {
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    configurable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("ItemActionMenu mobile sheet", () => {
  beforeEach(() => {
    isDesktop = false;
    canHover = true;
    mockNonTouchPointerEnvironment();
  });

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
    expect(dialog.className).toContain("z-app-modal");
    expect(dialog.querySelector(".listen-glass-panel")).toHaveStyle({
      bottom: "0px",
    });

    await user.click(screen.getByRole("menuitem", { name: /Share track/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOuterClick).not.toHaveBeenCalled();
  });

  it("renders media headers through the Listen artwork pipeline", () => {
    render(
      <ItemActionMenu
        actions={[
          {
            key: "play",
            label: "Play",
            onSelect: vi.fn(),
          },
        ]}
        header={{
          type: "media",
          title: "El Cielo",
          imageUrl: "/api/albums/8/cover?size=96",
        }}
        open
        position={null}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "El Cielo" })).toHaveAttribute(
      "data-artwork-managed",
      "true",
    );
  });

  it("adapts direct context-menu media headers to the same pipeline", () => {
    render(
      <ContextMenu
        items={[
          {
            key: "play",
            label: "Play",
            onSelect: vi.fn(),
          },
        ]}
        header={{
          type: "media",
          title: "High Vis",
          imageUrl: "/api/artists/9/photo?size=96",
        }}
        open
        position={null}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
      "data-artwork-managed",
      "true",
    );
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

  it("dismisses the mobile sheet when dragged past half its height", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const menuRef = createRef<HTMLDivElement>();
    const actions: ItemActionMenuEntry[] = [
      {
        key: "share",
        label: "Share track",
        onSelect: vi.fn(),
      },
    ];

    render(
      <ItemActionMenu
        actions={actions}
        open
        position={null}
        menuRef={menuRef}
        onClose={onClose}
      />,
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

    fireEvent.touchStart(handle, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 140 }] });
    fireEvent.touchEnd(handle);
    vi.advanceTimersByTime(180);

    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("ItemActionMenu desktop menu", () => {
  beforeEach(() => {
    isDesktop = true;
    canHover = true;
    mockNonTouchPointerEnvironment();
  });

  it("uses the canonical context menu surface", () => {
    const menuRef = createRef<HTMLDivElement>();
    const actions: ItemActionMenuEntry[] = [
      {
        key: "share",
        label: "Share track",
        onSelect: vi.fn(),
      },
    ];

    render(
      <ItemActionMenu
        actions={actions}
        open
        position={{ x: 12, y: 20 }}
        menuRef={menuRef}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("menu")).toHaveClass(
      "listen-glass-panel",
      "w-72",
      "rounded-2xl",
      "z-app-context-menu",
    );
  });
});
