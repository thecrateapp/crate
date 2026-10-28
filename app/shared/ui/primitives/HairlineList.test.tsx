import { createRef } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { formatRowIndex, HairlineList, HairlineRow } from "./HairlineList";

describe("HairlineList", () => {
  it("renders numbered rows with hairline dividers and a trailing slot", () => {
    render(
      <HairlineList label="Probable setlist">
        <HairlineRow index={1} trailing={<span>92%</span>}>
          Shanty
        </HairlineRow>
        <HairlineRow index={2} muted>
          Skin in the Game
        </HairlineRow>
      </HairlineList>,
    );

    const list = screen.getByRole("list", { name: "Probable setlist" });
    expect(list.tagName).toBe("OL");
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveClass(
      "border-b",
      "border-border-quiet-subtle",
      "min-h-8",
      "[@media(pointer:coarse)]:min-h-11",
    );
    expect(first).toHaveTextContent("01 Shanty 92%");
    expect(second).toHaveAttribute("data-muted", "true");
    expect(within(second!).getByText("Skin in the Game")).toHaveClass(
      "text-text-subtle",
    );
  });

  it("omits the index column when no index is given", () => {
    render(
      <HairlineList as="ul">
        <HairlineRow>Untitled</HairlineRow>
      </HairlineList>,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(/^Untitled$/);
  });

  it("starts with a quiet rule unless ruled is false", () => {
    const { rerender } = render(
      <HairlineList label="Tracks">
        <HairlineRow>Shanty</HairlineRow>
      </HairlineList>,
    );
    expect(screen.getByRole("list")).toHaveClass(
      "border-t",
      "border-border-quiet",
    );

    rerender(
      <HairlineList label="Tracks" ruled={false}>
        <HairlineRow>Shanty</HairlineRow>
      </HairlineList>,
    );
    expect(screen.getByRole("list")).not.toHaveClass("border-t");
  });

  it("passes list and row attributes and handlers to their semantic elements", async () => {
    const onListClick = vi.fn();
    const onRowClick = vi.fn();
    render(
      <HairlineList
        as="ul"
        id="setlist"
        aria-describedby="setlist-description"
        data-testid="setlist"
        onClick={onListClick}
        className="list-override"
      >
        <HairlineRow
          id="shanty"
          aria-current="true"
          title="Current track"
          onClick={onRowClick}
          className="row-override"
        >
          Shanty
        </HairlineRow>
      </HairlineList>,
    );
    const list = screen.getByRole("list");
    const row = screen.getByRole("listitem");
    expect(list).toHaveAttribute("id", "setlist");
    expect(list).toHaveAttribute("aria-describedby", "setlist-description");
    expect(list).toHaveAttribute("data-testid", "setlist");
    expect(list).toHaveClass("list-override");
    expect(row).toHaveAttribute("id", "shanty");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute("title", "Current track");
    expect(row).toHaveClass("row-override");
    await userEvent.click(row);
    expect(onRowClick).toHaveBeenCalledOnce();
    expect(onListClick).toHaveBeenCalledOnce();
  });

  it("reveals the decorative active bar and wash when a row becomes active", () => {
    const { rerender } = render(<HairlineRow>Shanty</HairlineRow>);
    const row = screen.getByRole("listitem");
    const bar = row.querySelector('[data-slot="active-bar"]');
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).toHaveClass("w-0.5", "bg-accent-action-hi", "scale-y-0");
    expect(row).not.toHaveAttribute("data-active");
    expect(row).not.toHaveClass("crate-row-highlight");

    rerender(<HairlineRow active>Shanty</HairlineRow>);
    expect(row).toHaveAttribute("data-active", "true");
    expect(row).toHaveClass("crate-row-highlight");
    expect(bar).toHaveClass("scale-y-100");
    expect(bar).not.toHaveClass("scale-y-0");
  });

  it("truncates titles by default and allows multi-line content", () => {
    const { rerender } = render(<HairlineRow>Long track title</HairlineRow>);
    expect(screen.getByText("Long track title")).toHaveClass("truncate");

    rerender(<HairlineRow truncate={false}>Long track title</HairlineRow>);
    expect(screen.getByText("Long track title")).not.toHaveClass("truncate");
  });

  it("makes the single link child fill the row including its index and trailing content", async () => {
    const linkRef = createRef<HTMLAnchorElement>();
    const onLinkClick = vi.fn((event) => event.preventDefault());
    const onRowClick = vi.fn();
    render(
      <HairlineList>
        <HairlineRow
          asChild
          index={3}
          trailing={<span>92%</span>}
          id="track-row"
          onClick={onRowClick}
        >
          <a
            href="/tracks/shanty"
            ref={linkRef}
            onClick={onLinkClick}
            className="link-override"
          >
            Shanty
          </a>
        </HairlineRow>
      </HairlineList>,
    );

    const row = screen.getByRole("listitem");
    const link = screen.getByRole("link", { name: "03 Shanty 92%" });
    expect(row).toHaveAttribute("id", "track-row");
    expect(link).not.toHaveAttribute("id", "track-row");
    expect(link).toHaveAttribute("href", "/tracks/shanty");
    expect(linkRef.current).toBe(link);
    expect(link).toHaveClass(
      "w-full",
      "min-h-8",
      "[@media(pointer:coarse)]:min-h-11",
      "link-override",
    );
    expect(within(link).getByText("03")).toBeInTheDocument();
    expect(within(link).getByText("92%")).toBeInTheDocument();
    expect(within(row).getAllByRole("link")).toHaveLength(1);
    await userEvent.click(within(link).getByText("92%"));
    expect(onLinkClick).toHaveBeenCalledOnce();
    expect(onRowClick).toHaveBeenCalledOnce();
  });

  it("preserves a button child's ref and keyboard activation without nesting buttons", async () => {
    const buttonRef = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <HairlineList>
        <HairlineRow asChild trailing={<span>Play</span>}>
          <button type="button" ref={buttonRef} onClick={onClick}>
            Shanty
          </button>
        </HairlineRow>
      </HairlineList>,
    );
    const button = screen.getByRole("button", { name: "Shanty Play" });
    expect(buttonRef.current).toBe(button);
    expect(button).toHaveClass(
      "w-full",
      "min-h-8",
      "[@media(pointer:coarse)]:min-h-11",
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("pads row indices to two digits", () => {
    expect(formatRowIndex(3)).toBe("03");
    expect(formatRowIndex(12)).toBe("12");
  });
});
