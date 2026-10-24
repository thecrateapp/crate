import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TidalAlbumCard } from "./TidalAlbumCard";
import { api } from "@/lib/api";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
});
it("retains the artist-scoped queue payload and queued disabled state", async () => {
  vi.mocked(api).mockResolvedValue({});
  render(
    <TidalAlbumCard
      artist="Artist"
      artistId={22}
      title="Album"
      year="2026"
      tracks={10}
      cover={null}
      url="tidal://album"
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Download Album" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/tidal/download-missing/artists/22",
      "POST",
      {
        albums: [{ url: "tidal://album", title: "Album", cover_url: null }],
      },
    ),
  );
  expect(screen.getByText("Queued")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download Album" })).toBeDisabled();
});
