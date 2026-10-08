import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions/useItemActionMenu";

import { EntityAvatar } from "./EntityAvatar";
import { EntityCard } from "./EntityCard";
import { EntityRow } from "./EntityRow";

let isDesktop = false;
let canHover = false;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => canHover,
}));

function makeGetActions() {
  return vi.fn((): ItemActionMenuEntry[] => [
    { key: "share", label: "Share", onSelect: vi.fn() },
  ]);
}

function article() {
  return screen.getByRole("article");
}

function menuItem() {
  return screen.queryByRole("menuitem", { name: /Share/i });
}

const INTERACTIVE_SELECTOR =
  "button, a[href], input, select, textarea, [role='button'], [tabindex]";

describe("EntityCard", () => {
  beforeEach(() => {
    isDesktop = false;
    canHover = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an article with an inner primary button and sibling controls", () => {
    const onOpen = vi.fn();
    render(
      <EntityCard
        title="Discovery"
        subtitle="Daft Punk"
        onOpen={onOpen}
        actionMenu={{ getActions: makeGetActions() }}
        overlay={{
          onPlay: vi.fn(),
          playLabel: "Play Discovery",
          follow: { following: false, onToggle: vi.fn(), label: "Save" },
        }}
      />,
    );

    const root = article();
    expect(root).toHaveClass("item-action-target");
    expect(root).not.toHaveAttribute("role");
    expect(root).not.toHaveAttribute("tabindex");

    const primary = within(root).getByRole("button", {
      name: /^Discovery/,
    });
    expect(primary.tagName).toBe("BUTTON");
    expect(primary.querySelector(INTERACTIVE_SELECTOR)).toBeNull();

    for (const name of [/More actions/, /Play Discovery/, /Save/]) {
      const control = within(root).getByRole("button", { name });
      expect(primary.contains(control)).toBe(false);
    }
    expect(root.querySelector("[role='button']")).toBeNull();

    fireEvent.click(primary);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders a link when href is provided", () => {
    render(
      <MemoryRouter>
        <EntityCard title="Discovery" href="/albums/discovery" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Discovery/ })).toHaveAttribute(
      "href",
      "/albums/discovery",
    );
  });

  it("does not compute menu entries until the menu opens", () => {
    const getActions = makeGetActions();
    render(
      <EntityCard
        title="Discovery"
        onOpen={vi.fn()}
        actionMenu={{ getActions }}
      />,
    );

    expect(getActions).not.toHaveBeenCalled();
    fireEvent.contextMenu(article(), { clientX: 10, clientY: 10 });
    expect(getActions).toHaveBeenCalledTimes(1);
    expect(menuItem()).toBeInTheDocument();
  });

  it("opens the menu with a touch long-press and swallows the click", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(
      <EntityCard
        title="Discovery"
        onOpen={onOpen}
        actionMenu={{ getActions: makeGetActions() }}
      />,
    );
    const primary = screen.getByRole("button", { name: /Discovery/ });

    fireEvent.pointerDown(primary, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(primary, { pointerType: "touch" });
    fireEvent.click(primary);

    expect(menuItem()).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the menu with the ContextMenu key", () => {
    render(
      <EntityCard
        title="Discovery"
        onOpen={vi.fn()}
        actionMenu={{ getActions: makeGetActions() }}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /Discovery/ }), {
      key: "ContextMenu",
    });
    expect(menuItem()).toBeInTheDocument();
  });

  it("opens the menu with Shift+F10", () => {
    render(
      <EntityCard
        title="Discovery"
        onOpen={vi.fn()}
        actionMenu={{ getActions: makeGetActions() }}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /Discovery/ }), {
      key: "F10",
      shiftKey: true,
    });
    expect(menuItem()).toBeInTheDocument();
  });

  it("opens the menu from the more button without calling onOpen", () => {
    const onOpen = vi.fn();
    render(
      <EntityCard
        title="Discovery"
        onOpen={onOpen}
        menuLabel="Más acciones"
        actionMenu={{ getActions: makeGetActions() }}
      />,
    );
    const more = screen.getByRole("button", { name: "Más acciones" });
    expect(more).toHaveAttribute("aria-haspopup", "menu");
    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(more);

    expect(onOpen).not.toHaveBeenCalled();
    expect(menuItem()).toBeInTheDocument();
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  it("supports hover, always and none menu button modes", () => {
    const getActions = makeGetActions();
    const { rerender } = render(
      <EntityCard title="Discovery" actionMenu={{ getActions }} />,
    );
    expect(screen.getByRole("button", { name: "More actions" })).toHaveClass(
      "pointer-fine:opacity-0",
    );

    rerender(
      <EntityCard
        title="Discovery"
        actionMenu={{ getActions }}
        menuButton="always"
      />,
    );
    const always = screen.getByRole("button", { name: "More actions" });
    expect(always).not.toHaveClass("pointer-fine:opacity-0");
    expect(always).toHaveClass("opacity-100");

    rerender(
      <EntityCard
        title="Discovery"
        actionMenu={{ getActions }}
        menuButton="none"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
    fireEvent.contextMenu(article());
    expect(menuItem()).toBeInTheDocument();
  });

  it("hides the more button when there is no menu", () => {
    render(<EntityCard title="Discovery" onOpen={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
  });

  it("hides the more button and context menu when hasActions is false", () => {
    const getActions = makeGetActions();
    render(
      <EntityCard
        title="Discovery"
        onOpen={vi.fn()}
        actionMenu={{ getActions, hasActions: false }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
    fireEvent.contextMenu(article());
    expect(menuItem()).not.toBeInTheDocument();
    expect(getActions).not.toHaveBeenCalled();
  });

  it("renders the rank before the title", () => {
    render(<EntityCard title="Discovery" rank={3} meta="12 plays" />);
    const rank = article().querySelector("[data-slot='entity-rank']");
    expect(rank).toHaveTextContent("3");
    expect(screen.getByText("12 plays")).toBeInTheDocument();
  });

  it("calls play and follow callbacks without bubbling to the card", () => {
    const onOpen = vi.fn();
    const onPlay = vi.fn();
    const onToggle = vi.fn();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <EntityCard
          title="Discovery"
          onOpen={onOpen}
          overlay={{
            onPlay,
            playLabel: "Play Discovery",
            follow: {
              following: true,
              onToggle,
              label: "Save",
              labelActive: "Saved",
            },
          }}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play Discovery" }));
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("delegates menu rendering to renderMenu only while open", () => {
    const renderMenu = vi.fn(() => <div role="menu">Custom menu</div>);
    render(<EntityCard title="Discovery" renderMenu={renderMenu} />);

    expect(renderMenu).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(renderMenu).toHaveBeenCalled();
    expect(screen.getByText("Custom menu")).toBeInTheDocument();
  });

  it("disables the primary action and the menu when disabled", () => {
    const getActions = makeGetActions();
    render(
      <EntityCard
        title="Discovery"
        onOpen={vi.fn()}
        disabled
        actionMenu={{ getActions }}
      />,
    );
    expect(screen.getByRole("button", { name: /Discovery/ })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
    fireEvent.contextMenu(article());
    expect(getActions).not.toHaveBeenCalled();
  });
});

describe("EntityRow", () => {
  beforeEach(() => {
    isDesktop = false;
    canHover = false;
  });

  it("renders an article with leading, primary button and trailing siblings", () => {
    const onOpen = vi.fn();
    render(
      <EntityRow
        title="Around the World"
        subtitle="Daft Punk"
        rank={1}
        cover={{ src: null, alt: "" }}
        trailing={<button type="button">Like</button>}
        onOpen={onOpen}
        actionMenu={{ getActions: makeGetActions() }}
      />,
    );

    const root = article();
    expect(root).toHaveClass("item-action-target");
    expect(root).toHaveAttribute("data-density", "default");
    const primary = within(root).getByRole("button", {
      name: /Around the World/,
    });
    expect(primary.querySelector(INTERACTIVE_SELECTOR)).toBeNull();
    expect(primary.contains(screen.getByRole("button", { name: "Like" }))).toBe(
      false,
    );
    expect(root.querySelector("[data-slot='entity-rank']")).toHaveTextContent(
      "1",
    );
    expect(
      primary.querySelector("[data-testid='media-cover-fallback']"),
    ).toHaveClass("size-12");

    fireEvent.click(primary);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("supports compact density", () => {
    render(
      <EntityRow
        title="Around the World"
        density="compact"
        cover={{ src: null }}
        actionMenu={{ getActions: makeGetActions() }}
      />,
    );
    expect(article()).toHaveAttribute("data-density", "compact");
    expect(article()).toHaveClass("py-1.5");
    expect(
      article().querySelector("[data-testid='media-cover-fallback']"),
    ).toHaveClass("size-10");
    expect(screen.getByRole("button", { name: "More actions" })).toHaveClass(
      "size-8",
    );
  });

  it("marks the active row", () => {
    render(<EntityRow title="Around the World" active onOpen={vi.fn()} />);
    expect(article()).toHaveAttribute("data-active", "true");
    expect(
      screen.getByRole("button", { name: /Around the World/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Around the World")).toHaveClass(
      "text-accent-action",
    );
  });

  it("computes menu entries lazily and opens with the ContextMenu key", () => {
    const getActions = makeGetActions();
    render(
      <EntityRow
        title="Around the World"
        onOpen={vi.fn()}
        actionMenu={{ getActions }}
      />,
    );
    expect(getActions).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: /Around/ }), {
      key: "ContextMenu",
    });
    expect(getActions).toHaveBeenCalledTimes(1);
    expect(menuItem()).toBeInTheDocument();
  });

  it("opens from the more button without calling onOpen", () => {
    const onOpen = vi.fn();
    render(
      <EntityRow
        title="Around the World"
        onOpen={onOpen}
        actionMenu={{ getActions: makeGetActions() }}
      />,
    );
    const more = screen.getByRole("button", { name: "More actions" });
    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(more);
    expect(onOpen).not.toHaveBeenCalled();
    expect(menuItem()).toBeInTheDocument();
  });

  it("keeps the more button but ignores gestures when the target is disabled", () => {
    render(
      <EntityRow
        title="Around the World"
        disableItemActionTarget
        actionMenu={{ getActions: makeGetActions() }}
      />,
    );
    fireEvent.contextMenu(article());
    expect(menuItem()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(menuItem()).toBeInTheDocument();
  });
});

describe("EntityAvatar", () => {
  it("renders initials as fallback", () => {
    render(<EntityAvatar name="Ada Lovelace" />);
    expect(screen.getByRole("img", { name: "Ada Lovelace" })).toHaveTextContent(
      "AL",
    );
  });

  it("applies shape, size and ring", () => {
    const { container } = render(
      <EntityAvatar name="Ada" shape="rounded" size="lg" ring="accent" />,
    );
    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar).toHaveAttribute("data-shape", "rounded");
    expect(avatar).toHaveAttribute("data-size", "lg");
    expect(avatar).toHaveAttribute("data-ring", "accent");
    expect(avatar).toHaveClass("ring-2");
  });

  it("forwards renderImage to the avatar and keeps the initials fallback", () => {
    render(
      <EntityAvatar
        name="Ada Lovelace"
        src="/ada.jpg"
        renderImage={(image) => (
          <img
            data-testid="entity-avatar-image"
            src={image.src}
            alt={image.alt}
            onError={image.onError}
          />
        )}
      />,
    );
    const image = screen.getByTestId("entity-avatar-image");
    expect(image).toHaveAttribute("src", "/ada.jpg");
    fireEvent.error(image);
    expect(screen.queryByTestId("entity-avatar-image")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ada Lovelace" })).toHaveTextContent(
      "AL",
    );
  });

  it("renders a labelled badge", () => {
    render(
      <EntityAvatar
        name="Ada"
        badge={<span>live</span>}
        badgeLabel="Listening now"
        className="custom"
      />,
    );
    const badge = screen.getByRole("img", { name: "Listening now" });
    expect(badge).toHaveTextContent("live");
    expect(badge.parentElement).toHaveClass("custom");
  });
});
