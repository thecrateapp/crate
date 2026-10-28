import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ItemActionMenu, ItemActionMenuButton } from "./ItemActionMenu";

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

describe("ItemActionMenu", () => {
  beforeEach(() => {
    isDesktop = false;
    canHover = true;
    mockNonTouchPointerEnvironment();
  });

  it("renders the controlled menu wrapper in mobile sheet mode", () => {
    render(
      <ItemActionMenu
        actions={[{ key: "share", label: "Share", onSelect: vi.fn() }]}
        open
        position={null}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Share/i }),
    ).toBeInTheDocument();
  });

  it("renders the controlled menu wrapper in desktop mode", () => {
    isDesktop = true;
    render(
      <ItemActionMenu
        actions={[{ key: "share", label: "Share", onSelect: vi.fn() }]}
        open
        position={{ x: 12, y: 20 }}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("menu")).toHaveClass("z-app-context-menu");
  });
  it.each([
    ["desktop", true],
    ["mobile sheet", false],
  ] as const)(
    "forwards the consumer surface through the %s wrapper without changing action callbacks",
    async (_mode, desktop) => {
      isDesktop = desktop;
      const menuRef = createRef<HTMLDivElement>();
      const onSelect = vi.fn();
      const onClose = vi.fn();
      render(
        <ItemActionMenu
          actions={[{ key: "share", label: "Share", onSelect }]}
          open
          position={desktop ? { x: 12, y: 20 } : null}
          menuRef={menuRef}
          onClose={onClose}
          surfaceClassName="consumer-actions-surface"
          sheetLabel="Acciones de la canción"
        />,
      );

      expect(menuRef.current).toHaveClass("consumer-actions-surface");
      expect(menuRef.current).toHaveClass(
        desktop ? "crate-overlay-surface" : "crate-overlay-panel",
      );
      if (!desktop) {
        expect(
          screen.getByRole("dialog", { name: "Acciones de la canción" }),
        ).toContainElement(menuRef.current);
      }
      await userEvent.click(screen.getByRole("menuitem", { name: "Share" }));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );
});

describe("ItemActionMenuButton", () => {
  it("renders a trigger button", () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();

    render(
      <ItemActionMenuButton
        buttonRef={ref}
        onClick={onClick}
        hasActions
        title="More"
      />,
    );

    const button = screen.getByRole("button", { name: /More/i });
    expect(button).toBeInTheDocument();
  });

  it("exposes menu popup semantics and the focus ring", () => {
    const { rerender } = render(
      <ItemActionMenuButton
        buttonRef={createRef<HTMLButtonElement>()}
        onClick={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "More actions" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).not.toHaveAttribute("aria-expanded");
    expect(button).not.toHaveClass("focus-visible:shadow-focus");

    rerender(
      <ItemActionMenuButton
        buttonRef={createRef<HTMLButtonElement>()}
        onClick={vi.fn()}
        title="Más acciones"
        expanded
      />,
    );

    expect(
      screen.getByRole("button", { name: "Más acciones" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("returns null when hasActions=false", () => {
    const { container } = render(
      <ItemActionMenuButton
        buttonRef={createRef<HTMLButtonElement>()}
        onClick={vi.fn()}
        hasActions={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
