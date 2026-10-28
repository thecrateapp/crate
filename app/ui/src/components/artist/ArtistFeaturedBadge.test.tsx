import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ArtistCard } from "./ArtistCard";
import { ArtistRow } from "./ArtistRow";

describe("featured artist indicators", () => {
  it("shows Featured and device readiness in the grid card", () => {
    render(
      <MemoryRouter>
        <ArtistCard
          name="Converge"
          artistId={7}
          albums={3}
          tracks={20}
          size_mb={100}
          primary_format="flac"
          isFeatured
          featuredDevices={["desktop", "mobile"]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Open Converge" })).toHaveAttribute(
      "href",
      "/artists/converge",
    );
    const image = screen.getByRole("img", { name: "Converge" });
    const portrait =
      image.closest("[data-slot=entity-artwork]") ?? image.parentElement;
    expect(portrait).toHaveClass("rounded-full");
    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByText("desktop")).toBeInTheDocument();
    expect(screen.getByText("mobile")).toBeInTheDocument();
  });

  it("shows Featured in the list row", () => {
    render(
      <MemoryRouter>
        <ArtistRow
          name="Converge"
          artistId={7}
          albums={3}
          tracks={20}
          total_size_mb={100}
          isFeatured
          featuredDevices={["desktop"]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Open Converge" })).toHaveAttribute(
      "href",
      "/artists/converge",
    );
    const image = screen.getByRole("img", { name: "Converge" });
    const portrait =
      image.closest("[data-slot=entity-artwork]") ?? image.parentElement;
    expect(portrait).toHaveClass("rounded-full");
    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByText("desktop")).toBeInTheDocument();
  });
  it("exposes card selection as a pressed action and preserves its callback", () => {
    const select = vi.fn();
    render(
      <MemoryRouter>
        <ArtistCard
          name="Converge"
          artistId={7}
          albums={3}
          tracks={20}
          size_mb={100}
          primary_format="flac"
          selectMode
          isSelected
          onClick={select}
        />
      </MemoryRouter>,
    );
    const action = screen.getByRole("button", { name: "Deselect Converge" });
    expect(action).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(action);
    expect(select).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
