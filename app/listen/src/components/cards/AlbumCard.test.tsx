import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { longPress, pressMenuKey } from "@/test/item-action-gestures";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { AlbumCard } from "./AlbumCard";

const apiMocks = vi.hoisted(() => ({
  resolveMaybeApiAssetUrl: vi.fn((url: string | null | undefined) =>
    url?.startsWith("/api/")
      ? `https://api.example.test${url}&token=native-token`
      : url ?? null,
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  resolveMaybeApiAssetUrl: apiMocks.resolveMaybeApiAssetUrl,
}));

vi.mock("@/components/actions/album-actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/actions/album-actions")>();
  return {
    ...actual,
    useAlbumActionEntries: vi.fn(actual.useAlbumActionEntries),
  };
});

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn(async () => false),
  }),
}));

function LocationProbe() {
  return <output data-testid="location-probe">{useLocation().pathname}</output>;
}

function mockMobilePointer() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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
  it("uses the themed foreground for the desktop play icon", () => {
    const { container } = renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} layout="grid" />,
    );

    expect(
      container.querySelector("button.bg-accent-action svg"),
    ).toHaveAttribute("fill", "currentColor");
  });

  it("resolves API cover paths for configurable native servers", () => {
    renderWithListenProviders(
      <AlbumCard
        artist="Hum"
        album="Inlet"
        globalAlbumUid="album-global-1"
        cover="/api/catalog/albums/album-global-1/cover?size=256"
      />,
    );

    expect(apiMocks.resolveMaybeApiAssetUrl).toHaveBeenCalledWith(
      "/api/catalog/albums/album-global-1/cover?size=256",
    );
    expect(screen.getByAltText("Inlet")).toHaveAttribute(
      "src",
      "https://api.example.test/api/catalog/albums/album-global-1/cover?size=256&token=native-token",
    );
    expect(screen.getByAltText("Inlet")).toHaveAttribute(
      "data-artwork-managed",
      "true",
    );
  });

  it("renders responsive WebP candidates for generated covers", () => {
    renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} layout="grid" />,
    );

    expect(
      screen.getByRole("button", { name: "Add to collection" }),
    ).toHaveClass("shadow-icon-control");
    const image = screen.getByAltText("Inlet");
    expect(image).toHaveAttribute("sizes");
    expect(image.getAttribute("srcset")).toMatch(/size=160[^,]* 160w/);
    expect(image.getAttribute("srcset")).toMatch(/size=320[^,]* 320w/);
    expect(image.getAttribute("srcset")).toMatch(/format=webp/);
    expect(image.closest("article")).toHaveClass("listen-deferred-grid-item");
  });

  it("keeps the album action menu trigger visible on the card", () => {
    renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} layout="grid" />,
    );

    expect(screen.getByRole("button", { name: "More actions" })).toBeVisible();
  });

  it("keeps the save heart circular at desktop sizes", () => {
    renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} layout="grid" />,
    );

    expect(
      screen.getByRole("button", { name: "Add to collection" }),
    ).toHaveClass("size-10", "rounded-full", "right-2", "top-2");
    expect(
      screen
        .getByRole("button", { name: "Add to collection" })
        .closest("[data-slot='entity-overlay']"),
    ).not.toBeNull();
  });

  it("keeps the canonical top-left menu trigger and does not navigate on Enter", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(
      <>
        <AlbumCard artist="Hum" album="Inlet" albumId={42} />
        <LocationProbe />
      </>,
    );

    const menuButton = screen.getByRole("button", { name: "More actions" });
    expect(menuButton).toHaveClass("left-4", "top-4");
    menuButton.focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("menuitem", { name: "Play album" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/");
  });

  it("navigates to the album from the primary card button", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(
      <>
        <AlbumCard artist="Hum" album="Inlet" albumId={42} />
        <LocationProbe />
      </>,
    );

    await user.click(screen.getByText("Inlet").closest("button")!);

    expect(screen.getByTestId("location-probe")).not.toHaveTextContent(/^\/$/);
  });

  it("opens the desktop action menu when the album only has stable route identifiers", async () => {
    renderWithListenProviders(
      <AlbumCard
        artist="Hum"
        album="Inlet"
        albumEntityUid="album-entity-1"
        albumSlug="inlet"
      />,
    );

    const card = screen.getByText("Inlet").closest("article");
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card!, { clientX: 160, clientY: 120 });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("listen-glass-panel", "w-72", "rounded-[12px]");
    expect(within(menu).getByText("Inlet")).toBeInTheDocument();
    expect(within(menu).getByText("Hum")).toBeInTheDocument();
    expect(within(menu).getByAltText("Inlet")).toHaveAttribute(
      "src",
      expect.stringContaining("https://api.example.test/api/"),
    );
    expect(
      await within(menu).findByRole("menuitem", { name: "Share album" }),
    ).toBeInTheDocument();
  });

  it("computes album menu entries only when the menu opens", async () => {
    vi.mocked(useAlbumActionEntries).mockClear();
    renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} />,
    );

    expect(useAlbumActionEntries).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByText("Inlet").closest("article")!);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(useAlbumActionEntries).toHaveBeenCalled();
  });

  it("opens the album menu with the ContextMenu key", async () => {
    renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} />,
    );

    pressMenuKey(screen.getByText("Inlet").closest("button")!);

    expect(
      await screen.findByRole("menuitem", { name: "Play album" }),
    ).toBeInTheDocument();
  });

  it("opens the album action sheet with a touch long-press on mobile", async () => {
    mockMobilePointer();
    renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} />,
    );

    await longPress(screen.getByText("Inlet").closest("article")!);

    const sheet = await screen.findByRole("dialog", { name: "Actions menu" });
    expect(
      within(sheet).getByRole("menuitem", { name: "Play album" }),
    ).toBeInTheDocument();
  });

  it("renders the row variant with rank, meta and extra actions", async () => {
    const onRemove = vi.fn();
    renderWithListenProviders(
      <AlbumCard
        variant="row"
        rank={2}
        meta="via Bandcamp"
        artist="Hum"
        album="Inlet"
        albumId={42}
        year="2020"
        extraActions={[
          { key: "remove", label: "Remove from Crate", onSelect: onRemove },
        ]}
      />,
    );

    const row = screen.getByText("Inlet").closest("article")!;
    expect(row).toHaveAttribute("data-density", "default");
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("via Bandcamp")).toBeInTheDocument();
    expect(within(row).getByText("2020 · Hum")).toBeInTheDocument();

    fireEvent.contextMenu(row);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remove from Crate" }),
    );
    expect(onRemove).toHaveBeenCalled();
  });

  it("localizes the pre-release badge and release date", () => {
    renderWithListenProviders(
      <AlbumCard
        artist="Hum"
        album="Inlet"
        albumId={42}
        isPreRelease
        releaseDate="2030-05-04"
      />,
      { locale: "es" },
    );

    expect(screen.getByText("Pre-release")).toBeInTheDocument();
    expect(screen.getByText(/^Sale el 4 may/)).toBeInTheDocument();
  });
});
