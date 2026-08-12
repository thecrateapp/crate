import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { ArtistArtworkSection } from "./ArtistArtworkSection";

vi.mock("./ArtistHeroArtworkEditor", () => {
  let mountCounter = 0;
  return {
    ArtistHeroArtworkEditor: ({
      genres = [],
      onUploaded,
    }: {
      genres?: string[];
      onUploaded?: () => void;
    }) => {
      const [mountId] = useState(() => ++mountCounter);
      return (
        <div data-testid="hero-editor-genres" data-mount-id={mountId}>
          {genres.join(",")}
          <button type="button" onClick={onUploaded}>
            Simulate hero upload
          </button>
        </div>
      );
    },
  };
});

vi.mock("./ArtistArtworkGallery", () => ({
  ArtistArtworkGallery: () => <div data-testid="artwork-gallery" />,
}));

vi.mock("@/components/ImageCropUpload", () => ({
  ImageCropUpload: () => null,
}));

vi.mock("@/lib/tasks", () => ({
  waitForTask: vi.fn(async () => ({ status: "completed" })),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

it("queues the bounded library hero backfill", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ status: "queued", task_id: "backfill-1" }),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<ArtistArtworkSection artistId={7} artistName="Converge" canEdit />);

  await userEvent.click(
    screen.getByRole("button", { name: "Backfill eligible artists" }),
  );

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/artwork/artist-heroes/backfill",
      expect.objectContaining({ method: "POST" }),
    ),
  );
});

it("passes the artist genres to the live hero preview", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "ok" })),
  );

  render(
    <ArtistArtworkSection
      artistId={7}
      artistName="Converge"
      genres={["hardcore", "mathcore"]}
      canEdit
    />,
  );

  expect(screen.getByTestId("hero-editor-genres")).toHaveTextContent(
    "hardcore,mathcore",
  );
});

it("keeps the hero editor mounted when artwork changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "ok" })),
  );

  render(<ArtistArtworkSection artistId={7} artistName="Converge" canEdit />);

  const editor = screen.getByTestId("hero-editor-genres");
  const mountId = editor.getAttribute("data-mount-id");
  await userEvent.click(
    screen.getByRole("button", { name: "Simulate hero upload" }),
  );

  await waitFor(() =>
    expect(screen.getByTestId("hero-editor-genres")).toHaveAttribute(
      "data-mount-id",
      mountId,
    ),
  );
});
