import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api };
});

import { CrateAlbumPicker } from "@/components/CrateAlbumPicker";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const firstAlbum = { artist: "High Vis", name: "Album One", year: 2024 };
const secondAlbum = { artist: "High Vis", name: "Album Two", year: 2025 };

describe("CrateAlbumPicker", () => {
  beforeEach(() => mocks.api.mockReset());

  it("uses the shared input primitive and relies on live search", () => {
    renderWithListenProviders(
      <CrateAlbumPicker existingAlbumUids={new Set()} onAdd={async () => {}} />,
    );

    expect(
      screen.getByRole("searchbox", { name: "Search albums" }),
    ).toHaveAttribute("data-slot", "input");
    expect(screen.queryByRole("button", { name: "Find albums" })).toBeNull();
  });

  it("keeps a stable row when results without catalog ids change order", async () => {
    mocks.api
      .mockResolvedValueOnce({ albums: [firstAlbum, secondAlbum] })
      .mockResolvedValueOnce({ albums: [secondAlbum, firstAlbum] });
    const user = userEvent.setup();

    renderWithListenProviders(
      <CrateAlbumPicker existingAlbumUids={new Set()} onAdd={async () => {}} />,
    );

    const search = screen.getByRole("searchbox", { name: "Search albums" });
    await user.type(search, "High Vis{Enter}");

    const firstRow = (await screen.findByText("Album One")).closest("li");
    await user.type(search, "{Enter}");

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Album Two")).toBeVisible();
    expect(screen.getByText("Album One").closest("li")).toBe(firstRow);
  });

  it("marks albums already in the Crate instead of offering to add them", async () => {
    mocks.api.mockResolvedValue({
      albums: [{ ...firstAlbum, global_album_uid: "album-1" }],
    });
    const user = userEvent.setup();

    renderWithListenProviders(
      <CrateAlbumPicker
        existingAlbumUids={new Set(["album-1"])}
        onAdd={async () => {}}
      />,
    );

    await user.type(
      screen.getByRole("searchbox", { name: "Search albums" }),
      "High Vis",
    );

    expect(await screen.findByText("Added")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add Album One by High Vis" }),
    ).toBeNull();
  });

  it("searches albums after the query changes without requiring the button", async () => {
    mocks.api.mockResolvedValue({ albums: [firstAlbum] });
    const user = userEvent.setup();

    renderWithListenProviders(
      <CrateAlbumPicker existingAlbumUids={new Set()} onAdd={async () => {}} />,
    );

    await user.type(
      screen.getByRole("searchbox", { name: "Search albums" }),
      "High Vis",
    );

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/catalog/search?q=High%20Vis&limit=20",
      );
    });
    expect(await screen.findByText("Album One")).toBeVisible();
  });
});
