import { screen } from "@testing-library/react";
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

  it("keeps a stable row when results without catalog ids change order", async () => {
    mocks.api
      .mockResolvedValueOnce({ albums: [firstAlbum, secondAlbum] })
      .mockResolvedValueOnce({ albums: [secondAlbum, firstAlbum] });
    const user = userEvent.setup();

    renderWithListenProviders(
      <CrateAlbumPicker existingAlbumUids={new Set()} onAdd={async () => {}} />,
    );

    const search = screen.getByRole("searchbox", { name: "Search albums" });
    const findAlbums = screen.getByRole("button", { name: "Find albums" });
    await user.type(search, "High Vis");
    await user.click(findAlbums);

    const firstRow = (await screen.findByText("Album One")).closest("li");
    await user.click(findAlbums);

    expect(await screen.findByText("Album Two")).toBeVisible();
    expect(screen.getByText("Album One").closest("li")).toBe(firstRow);
  });
});
