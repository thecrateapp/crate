import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Disc3, ListPlus, Play } from "@crate/ui/icons";

import {
  ContextMenu,
  shouldRenderDesktopContextMenu,
  type ContextMenuEntry,
  type ContextMenuMediaHeader,
} from "./ContextMenu";

let isDesktop = true;
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

const header: ContextMenuMediaHeader = {
  type: "media",
  title: "El Cielo",
  subtitle: "Dredg",
  detail: "Progressive rock",
  imageUrl: "/cover.jpg",
  imageAlt: "El Cielo cover",
  imageShape: "square",
  fallbackIcon: Disc3,
};

function actions(onSelect = vi.fn()): ContextMenuEntry[] {
  return [
    {
      key: "play",
      label: "Play now",
      icon: Play,
      onSelect,
    },
  ];
}

describe("ContextMenu", () => {
  beforeEach(() => {
    isDesktop = true;
    canHover = true;
    mockNonTouchPointerEnvironment();
  });

  it("renders the desktop menu with a media header", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();

    render(
      <ContextMenu
        header={header}
        items={actions(onSelect)}
        menuRef={createRef<HTMLDivElement>()}
        onClose={onClose}
        open
        position={{ x: 40, y: 64 }}
      />,
    );

    const menu = screen.getByRole("menu");
    expect(menu).toHaveClass(
      "listen-glass-panel",
      "w-72",
      "rounded-2xl",
      "z-app-context-menu",
    );
    expect(screen.getByText("El Cielo")).toBeInTheDocument();
    expect(screen.getByText("Dredg")).toBeInTheDocument();
    expect(screen.getByText("Progressive rock")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /Play now/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows fallback icon when imageUrl is null", () => {
    render(
      <ContextMenu
        header={{ ...header, imageUrl: null }}
        items={actions()}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    expect(screen.getByText("El Cielo")).toBeInTheDocument();
  });

  it("hides a broken media header image instead of showing browser broken-image chrome", () => {
    render(
      <ContextMenu
        header={header}
        items={actions()}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    const image = screen.getByRole("img", { name: "El Cielo cover" });
    fireEvent.error(image);

    expect(
      screen.queryByRole("img", { name: "El Cielo cover" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("El Cielo")).toBeInTheDocument();
  });

  it("retries the media header image when imageUrl changes", () => {
    const { rerender } = render(
      <ContextMenu
        header={header}
        items={actions()}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "El Cielo cover" }));

    rerender(
      <ContextMenu
        header={{ ...header, imageUrl: "/cover-2.jpg" }}
        items={actions()}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    expect(screen.getByRole("img", { name: "El Cielo cover" })).toHaveAttribute(
      "src",
      "/cover-2.jpg",
    );
  });

  it("uses the mobile sheet on non-desktop", () => {
    isDesktop = false;

    render(
      <ContextMenu
        header={header}
        items={actions()}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={null}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".listen-glass-panel")).toBeInTheDocument();
    expect(screen.getByText("El Cielo")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Play now/i }),
    ).toBeInTheDocument();
  });

  it("renders divider and label entries", () => {
    render(
      <ContextMenu
        items={[
          { type: "label", key: "section", label: "Section" },
          { type: "divider", key: "divider" },
          { key: "action", label: "Action", onSelect: vi.fn() },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    expect(screen.getByText("Section")).toBeInTheDocument();
    expect(document.querySelector(".border-t")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Action/i }),
    ).toBeInTheDocument();
  });

  it("renders disclosure children", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreatePlaylist = vi.fn();
    const onAddToFavorites = vi.fn();

    render(
      <ContextMenu
        header={header}
        items={[
          {
            type: "disclosure",
            key: "playlist",
            label: "Add to playlist",
            icon: ListPlus,
            expanded: true,
            onToggle: vi.fn(),
            items: [
              {
                key: "create-playlist",
                label: "Add new playlist",
                onSelect: onCreatePlaylist,
              },
              {
                key: "playlist-favorites",
                label: "Favorites",
                onSelect: onAddToFavorites,
              },
            ],
          },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={onClose}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    expect(
      screen.getByRole("menuitem", { name: /Add to playlist/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Favorites" }));

    expect(onAddToFavorites).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreatePlaylist).not.toHaveBeenCalled();
  });

  it("does not close when a disclosure parent is toggled", () => {
    const onClose = vi.fn();
    const onToggle = vi.fn();

    render(
      <ContextMenu
        items={[
          {
            type: "disclosure",
            key: "playlist",
            label: "Add to playlist",
            expanded: false,
            onToggle,
            items: [],
          },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={onClose}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /Add to playlist/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onSelect for disabled items", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <ContextMenu
        items={[
          {
            key: "delete",
            label: "Delete",
            disabled: true,
            onSelect,
          },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    await user.click(screen.getByRole("menuitem", { name: /Delete/i }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("handles async onSelect and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn().mockResolvedValue(undefined);

    render(
      <ContextMenu
        items={[{ key: "async", label: "Async", onSelect }]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={onClose}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    await user.click(screen.getByRole("menuitem", { name: /Async/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when there are no selectable entries", () => {
    const { container } = render(
      <ContextMenu
        items={[
          { type: "label", key: "l", label: "Only a label" },
          { type: "divider", key: "d" },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("shouldRenderDesktopContextMenu", () => {
  it("returns true only when desktop, hover, non-touch, non-capacitor", () => {
    expect(
      shouldRenderDesktopContextMenu({
        isDesktop: true,
        canHover: true,
        isTouchDominant: false,
        isCapacitor: false,
      }),
    ).toBe(true);
  });

  it("returns false when not desktop", () => {
    expect(
      shouldRenderDesktopContextMenu({
        isDesktop: false,
        canHover: true,
        isTouchDominant: false,
        isCapacitor: false,
      }),
    ).toBe(false);
  });

  it("returns false when cannot hover", () => {
    expect(
      shouldRenderDesktopContextMenu({
        isDesktop: true,
        canHover: false,
        isTouchDominant: false,
        isCapacitor: false,
      }),
    ).toBe(false);
  });

  it("returns false on touch-dominant", () => {
    expect(
      shouldRenderDesktopContextMenu({
        isDesktop: true,
        canHover: true,
        isTouchDominant: true,
        isCapacitor: false,
      }),
    ).toBe(false);
  });

  it("returns false in capacitor", () => {
    expect(
      shouldRenderDesktopContextMenu({
        isDesktop: true,
        canHover: true,
        isTouchDominant: false,
        isCapacitor: true,
      }),
    ).toBe(false);
  });

  it("returns false when forced mobile sheet", () => {
    expect(
      shouldRenderDesktopContextMenu({
        isDesktop: true,
        canHover: true,
        isTouchDominant: false,
        isCapacitor: false,
        forceMobileSheet: true,
      }),
    ).toBe(false);
  });
});
