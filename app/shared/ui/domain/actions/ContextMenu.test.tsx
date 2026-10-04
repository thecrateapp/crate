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
  type ContextMenuMediaImageProps,
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

  it("does not bubble clicks or pointer downs on the desktop menu to the parent row", () => {
    const onRowClick = vi.fn();
    const onRowPointerDown = vi.fn();
    render(
      <div onClick={onRowClick} onPointerDown={onRowPointerDown}>
        <ContextMenu
          header={header}
          items={actions()}
          menuRef={createRef<HTMLDivElement>()}
          onClose={vi.fn()}
          open
          position={{ x: 40, y: 64 }}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByText("El Cielo"));
    fireEvent.click(screen.getByText("El Cielo"));
    fireEvent.click(screen.getByRole("menu"));

    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowPointerDown).not.toHaveBeenCalled();
  });

  it("does not bubble clicks on the mobile sheet to the parent row", () => {
    isDesktop = false;
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <ContextMenu
          header={header}
          items={actions()}
          menuRef={createRef<HTMLDivElement>()}
          onClose={vi.fn()}
          open
          position={null}
        />
      </div>,
    );

    fireEvent.click(screen.getByText("El Cielo"));

    expect(onRowClick).not.toHaveBeenCalled();
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

  it("delegates media rendering when a consumer supplies an image pipeline", () => {
    const renderMediaImage = vi.fn((props: ContextMenuMediaImageProps) => (
      <span data-testid="managed-media-image" data-source={props.src} />
    ));

    render(
      <ContextMenu
        header={header}
        items={actions()}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
        renderMediaImage={renderMediaImage}
      />,
    );

    expect(renderMediaImage).toHaveBeenCalledOnce();
    expect(screen.getByTestId("managed-media-image")).toHaveAttribute(
      "data-source",
      "/cover.jpg",
    );
    expect(
      screen.queryByRole("img", { name: "El Cielo cover" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a managed image mounted so it can recover after a failure", () => {
    render(
      <ContextMenu
        header={header}
        items={actions()}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
        renderMediaImage={(props) => <img {...props} />}
      />,
    );

    const image = screen.getByRole("img", { name: "El Cielo cover" });
    fireEvent.error(image);
    expect(image).toBeInTheDocument();
    expect(image).toHaveClass("opacity-0");

    fireEvent.load(image);
    expect(image).not.toHaveClass("opacity-0");
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

  it("renders desktop disclosure children in a lateral submenu", () => {
    render(
      <ContextMenu
        items={[
          {
            type: "disclosure",
            key: "playlist",
            label: "Add to playlist",
            expanded: true,
            onToggle: vi.fn(),
            items: [
              {
                key: "playlist-favorites",
                label: "Favorites",
                onSelect: vi.fn(),
              },
            ],
          },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    expect(screen.getByTestId("context-menu-submenu-playlist")).toHaveClass(
      "fixed",
      "z-app-context-menu",
    );
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

  it("navigates menu items with arrow, Home and End keys", () => {
    render(
      <ContextMenu
        items={[
          { key: "play", label: "Play now", onSelect: vi.fn() },
          { type: "divider", key: "divider" },
          { key: "queue", label: "Add to queue", onSelect: vi.fn() },
          {
            key: "disabled",
            label: "Unavailable",
            disabled: true,
            onSelect: vi.fn(),
          },
          { key: "share", label: "Share", onSelect: vi.fn() },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    const menu = screen.getByRole("menu");
    const play = screen.getByRole("menuitem", { name: /Play now/i });
    const queue = screen.getByRole("menuitem", { name: /Add to queue/i });
    const share = screen.getByRole("menuitem", { name: /Share/i });

    expect(play).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(queue).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(share).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(play).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(share).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(play).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(share).toHaveFocus();
  });

  it("applies the focus ring token to menu items", () => {
    render(
      <ContextMenu
        items={actions()}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    expect(screen.getByRole("menuitem", { name: /Play now/i })).toHaveClass(
      "focus-visible:shadow-focus",
    );
  });

  it("restores focus to the trigger when the menu closes", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open menu";
    document.body.appendChild(trigger);
    trigger.focus();

    const props = {
      items: actions(),
      menuRef: createRef<HTMLDivElement>(),
      onClose: vi.fn(),
      position: { x: 12, y: 12 },
    };
    const { rerender } = render(<ContextMenu {...props} open />);

    expect(screen.getByRole("menuitem", { name: /Play now/i })).toHaveFocus();

    rerender(<ContextMenu {...props} open={false} />);

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("does not steal focus back when focus moved elsewhere before closing", () => {
    const trigger = document.createElement("button");
    const other = document.createElement("input");
    document.body.append(trigger, other);
    trigger.focus();

    const props = {
      items: actions(),
      menuRef: createRef<HTMLDivElement>(),
      onClose: vi.fn(),
      position: { x: 12, y: 12 },
    };
    const { rerender } = render(<ContextMenu {...props} open />);
    other.focus();
    rerender(<ContextMenu {...props} open={false} />);

    expect(other).toHaveFocus();
    trigger.remove();
    other.remove();
  });

  it("opens and enters a desktop submenu with ArrowRight and leaves it with ArrowLeft", () => {
    function renderMenu(expanded: boolean, onToggle: () => void) {
      return (
        <ContextMenu
          items={[
            { key: "play", label: "Play now", onSelect: vi.fn() },
            {
              type: "disclosure",
              key: "playlist",
              label: "Add to playlist",
              expanded,
              onToggle,
              items: [
                { key: "favorites", label: "Favorites", onSelect: vi.fn() },
                { key: "road", label: "Road trip", onSelect: vi.fn() },
              ],
            },
          ]}
          menuRef={createRef<HTMLDivElement>()}
          onClose={vi.fn()}
          open
          position={{ x: 12, y: 12 }}
        />
      );
    }

    let expanded = false;
    const onToggle = vi.fn(() => {
      expanded = !expanded;
    });
    const { rerender } = render(renderMenu(expanded, onToggle));
    const parent = screen.getByRole("menuitem", { name: /Add to playlist/i });

    expect(parent).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(parent).toHaveFocus();

    fireEvent.keyDown(parent, { key: "ArrowRight" });
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(renderMenu(expanded, onToggle));

    const submenu = screen.getByTestId("context-menu-submenu-playlist");
    const favorites = screen.getByRole("menuitem", { name: "Favorites" });
    const roadTrip = screen.getByRole("menuitem", { name: "Road trip" });
    expect(favorites).toHaveFocus();

    fireEvent.keyDown(submenu, { key: "ArrowDown" });
    expect(roadTrip).toHaveFocus();
    expect(parent).not.toHaveFocus();

    fireEvent.keyDown(submenu, { key: "ArrowLeft" });
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(parent).toHaveFocus();
  });

  it("adds consumer surface classes on top of the glass panel", () => {
    render(
      <ContextMenu
        items={[
          {
            type: "disclosure",
            key: "playlist",
            label: "Add to playlist",
            expanded: true,
            onToggle: vi.fn(),
            items: [{ key: "fav", label: "Favorites", onSelect: vi.fn() }],
          },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
        surfaceClassName="bg-surface-popover"
      />,
    );

    const [menu] = screen.getAllByRole("menu");
    expect(menu).toHaveClass("bg-surface-popover");
    expect(menu).toHaveClass("listen-glass-panel");
    const submenu = screen.getByTestId("context-menu-submenu-playlist");
    expect(submenu).toHaveClass("bg-surface-popover");
    expect(submenu).toHaveClass("listen-glass-panel");
  });

  it("keeps the listen glass surface on the submenu by default", () => {
    render(
      <ContextMenu
        items={[
          {
            type: "disclosure",
            key: "playlist",
            label: "Add to playlist",
            expanded: true,
            onToggle: vi.fn(),
            items: [{ key: "fav", label: "Favorites", onSelect: vi.fn() }],
          },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={{ x: 12, y: 12 }}
      />,
    );

    expect(screen.getByTestId("context-menu-submenu-playlist")).toHaveClass(
      "listen-glass-panel",
    );
  });

  it("navigates the mobile sheet with arrow keys and labels the sheet", () => {
    isDesktop = false;

    render(
      <ContextMenu
        items={[
          { key: "play", label: "Play now", onSelect: vi.fn() },
          { key: "share", label: "Share", onSelect: vi.fn() },
        ]}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        open
        position={null}
        sheetLabel="Acciones"
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Acciones" }),
    ).toBeInTheDocument();
    const play = screen.getByRole("menuitem", { name: /Play now/i });
    expect(play).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /Share/i })).toHaveFocus();
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
