import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BandcampItem } from "./BandcampItem";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/external-links", () => ({ openExternalUrl: openExternal }));
beforeEach(() => vi.clearAllMocks());

it("uses the actual album-card frame with a cover menu, full-width title and preserved import/open actions", async () => {
  const onImport = vi.fn();
  const item = {
    id: 8,
    artist_name: "Mixed Case Artist",
    album_title: "The Baneful Choir",
    item_url: "https://example.bandcamp.com/album/the-baneful-choir",
    owned: true,
    downloadable: true,
  };
  const { container } = renderWithListenProviders(
    <BandcampItem
      item={item}
      variant="tile"
      busyAction={null}
      onImport={onImport}
    />,
  );
  const card = container.querySelector('[data-slot="entity-card"]');
  expect(card).toBeInTheDocument();
  expect(card?.querySelector('[data-slot="entity-row"]')).toBeNull();
  expect(screen.getByText(item.album_title)).toHaveClass("truncate");
  expect(screen.getByRole("button", { name: "More actions" })).toHaveClass(
    "absolute",
    "left-4",
    "top-4",
  );
  expect(
    screen.queryByRole("button", { name: /^Import:/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Import" }));
  expect(onImport).toHaveBeenCalledExactlyOnceWith(item);
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Open on Bandcamp" }),
  );
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(item.item_url);
  fireEvent.click(screen.getByText(item.album_title));
  expect(openExternal).toHaveBeenCalledTimes(2);
});

it("uses the shared row and managed MediaCover while preserving import and context menu actions", async () => {
  const onImport = vi.fn();
  const item = {
    id: 7,
    artist_name: "Mixed Case Artist",
    album_title: "Evening Music",
    owned: true,
    downloadable: true,
  };
  const { container } = renderWithListenProviders(
    <BandcampItem
      item={item}
      variant="row"
      busyAction={null}
      onImport={onImport}
    />,
  );
  expect(
    container.querySelector('[data-slot="entity-row"]'),
  ).toBeInTheDocument();
  expect(screen.getByTestId("media-cover-fallback")).toHaveClass("size-14");
  expect(screen.getByText("Evening Music")).not.toHaveClass("uppercase");
  fireEvent.click(screen.getByRole("button", { name: /import/i }));
  expect(onImport).toHaveBeenCalledWith(item);
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Import" }));
  expect(onImport).toHaveBeenCalledTimes(2);
});
