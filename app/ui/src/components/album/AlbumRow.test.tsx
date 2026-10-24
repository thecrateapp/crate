import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { AlbumRow } from "./AlbumRow";
beforeEach(() =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  ),
);
it("keeps album and artist navigation as separate native links beside row actions", () => {
  render(
    <MemoryRouter>
      <AlbumRow
        artist="Converge"
        artistSlug="converge"
        album="Jane Doe"
        albumSlug="jane-doe"
        year="2001"
        tracks={12}
        actions={<button>Manage</button>}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: /Jane Doe/ })).toHaveAttribute(
    "href",
  );
  expect(screen.getByRole("link", { name: "Converge" })).toHaveAttribute(
    "href",
    "/artists/converge",
  );
  expect(
    screen.getByRole("button", { name: "Manage" }).closest("a"),
  ).toBeNull();
  expect(
    screen.getByText("Jane Doe").closest('[data-slot="entity-row"]'),
  ).toBeInTheDocument();
});
