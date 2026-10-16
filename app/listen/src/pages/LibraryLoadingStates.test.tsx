import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { LibraryAlbumsTab } from "./LibraryAlbumsTab";
import { LibraryArtistsTab } from "./LibraryArtistsTab";

vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({ data: null, loading: true, error: null, refetch: vi.fn() }),
}));
it.each([LibraryAlbumsTab, LibraryArtistsTab])(
  "reserves the actual Library media-grid density while data loads",
  (Tab) => {
    const { container } = renderWithListenProviders(<Tab />);
    expect(screen.getByRole("status")).toHaveAccessibleName();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByTestId("media-grid")).toHaveAttribute(
      "data-density",
      "default",
    );
    expect(
      container.querySelectorAll('[data-slot="skeleton-cover"]'),
    ).toHaveLength(12);
    expect(container.querySelector(".animate-spin, .animate-pulse")).toBeNull();
  },
);

it.each([LibraryAlbumsTab, LibraryArtistsTab])(
  "keeps mobile sort-row space and the actual card shape while loading",
  (Tab) => {
    const { container } = renderWithListenProviders(<Tab />);
    expect(
      container.querySelector('[data-slot="library-sort-placeholder"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="library-sort-placeholder"]'),
    ).toHaveTextContent("——");
    expect(
      container.querySelector('[data-slot="skeleton-cover"]'),
    ).toHaveAttribute(
      "data-variant",
      Tab === LibraryArtistsTab ? "artist" : "album",
    );
  },
);
