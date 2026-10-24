import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ShowCard, type ShowEvent } from "./ShowCard";
import fixture from "../../../../../tests/admin-e2e/fixtures/upcoming-1ao.json";
const show = { ...fixture.items[4]!, type: "show" as const };
describe("Admin ShowCard reviewed glyph contract", () => {
  it("keeps real artist/ticket destinations with shared icon actions and no decorative glyphs", () => {
    const { container } = render(
      <MemoryRouter>
        <ShowCard show={show} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Open artist" })).toHaveAttribute(
      "href",
      "/artists/costa-norte",
    );
    expect(screen.getByRole("link", { name: "Get tickets" })).toHaveAttribute(
      "href",
      show.url,
    );
    expect(screen.getByRole("link", { name: "Get tickets" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(
      screen.getByRole("group", { name: "Show preview actions" }),
    ).toBeVisible();
    expect(screen.getByText("Sala Puerto")).toBeInTheDocument();
  });
  it("retains controlled card keyboard expansion, external UX and close glyph", () => {
    const toggle = vi.fn();
    const { container, rerender } = render(
      <MemoryRouter>
        <ShowCard show={show} expanded={false} onToggle={toggle} />
      </MemoryRouter>,
    );
    const card = screen.getByRole("button");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTitle("Open tickets").querySelector("svg"),
    ).toHaveAttribute("data-admin-ux", "show-tickets-external");
    rerender(
      <MemoryRouter>
        <ShowCard show={show} expanded onToggle={toggle} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close show details" }));
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("svg")).toHaveLength(3);
    expect(
      container.querySelector('svg[data-admin-ux="show-close"]'),
    ).toHaveAttribute("data-admin-ux", "show-close");
  });
  it("preserves legacy ShowEvent compact and missing-data rendering", () => {
    const legacy = {
      name: "Festival",
      date: "2026-10-24",
      local_time: "21:00",
      venue: "Sala",
      lineup: ["Luz Polar"],
      city: "Madrid",
      url: "",
    } as ShowEvent;
    const { rerender } = render(
      <MemoryRouter>
        <ShowCard show={legacy} compact />
      </MemoryRouter>,
    );
    expect(screen.getByText("Luz Polar")).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <ShowCard show={legacy} />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("link", { name: "Get tickets" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open artist" }),
    ).not.toBeInTheDocument();
  });
  it("uses an opaque raised surface for both static and interactive show cards", () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <ShowCard show={show} />
      </MemoryRouter>,
    );
    const staticSurface = screen
      .getByText("Sala Puerto")
      .closest(".bg-raised-surface");
    expect(staticSurface).toHaveClass("shadow-none");
    expect(container.querySelector('[class*="backdrop-blur"]')).toBeNull();

    rerender(
      <MemoryRouter>
        <ShowCard show={show} expanded={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button")).toHaveClass(
      "bg-raised-surface",
      "shadow-none",
    );
  });
});
