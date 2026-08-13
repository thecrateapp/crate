import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Disc3, ListPlus, Play } from "@crate/ui/icons";

import {
  ContextMenu,
  type ContextMenuEntry,
  type ContextMenuMediaHeader,
} from "@crate/ui/domain/actions";

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

  it("renders the canonical glass desktop menu with a media header", async () => {
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
      "fixed",
      "max-w-[calc(100vw-24px)]",
      "max-h-[calc(100vh-24px)]",
      "w-72",
      "rounded-2xl",
      "overflow-y-auto",
      "overflow-x-hidden",
      "z-app-context-menu",
    );
    expect(screen.getByText("El Cielo")).toBeInTheDocument();
    expect(screen.getByText("Dredg")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /Play now/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the same header and actions inside the mobile sheet", () => {
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

  it("renders disclosure children with the same menu item treatment", async () => {
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
    ).toHaveClass("rounded-md");

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
});
