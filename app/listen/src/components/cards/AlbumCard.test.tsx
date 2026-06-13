import { fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { AlbumCard } from "./AlbumCard";

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn(async () => false),
  }),
}));

function mockDesktopPointer() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("min-width: 768px") ||
        query === "(hover: hover) and (pointer: fine)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeAll(() => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
});

beforeEach(() => {
  mockDesktopPointer();
});

describe("AlbumCard", () => {
  it("opens the desktop action menu when the album only has stable route identifiers", async () => {
    renderWithListenProviders(
      <AlbumCard
        artist="Hum"
        album="Inlet"
        albumEntityUid="album-entity-1"
        albumSlug="inlet"
      />,
    );

    const card = screen.getByText("Inlet").closest('[role="button"]');
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card!, { clientX: 160, clientY: 120 });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("listen-glass-panel", "w-72", "rounded-2xl");
    expect(within(menu).getByText("Inlet")).toBeInTheDocument();
    expect(within(menu).getByText("Hum")).toBeInTheDocument();
    expect(
      await within(menu).findByRole("menuitem", { name: "Share album" }),
    ).toBeInTheDocument();
  });
});
