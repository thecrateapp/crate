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
      reload,
    }: {
      genres?: string[];
      onUploaded?: () => void;
      reload?: { token: number; composition: "desktop" | "mobile" } | null;
    }) => {
      const [mountId] = useState(() => ++mountCounter);
      return (
        <div
          data-testid="hero-editor-genres"
          data-mount-id={mountId}
          data-reload-token={reload?.token ?? 0}
          data-reload-composition={reload?.composition ?? ""}
        >
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
  ArtistArtworkGallery: ({
    onChanged,
    onHeroChanged,
  }: {
    onChanged?: () => void;
    onHeroChanged?: (composition: "desktop" | "mobile") => void;
  }) => (
    <div data-testid="artwork-gallery">
      <button
        type="button"
        onClick={() => {
          onChanged?.();
          onHeroChanged?.("mobile");
        }}
      >
        Simulate gallery mobile hero assignment
      </button>
    </div>
  ),
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

it("reloads the selected hero composition after a gallery assignment", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "ok" })),
  );

  render(<ArtistArtworkSection artistId={7} artistName="Converge" canEdit />);

  await userEvent.click(
    screen.getByRole("button", {
      name: "Simulate gallery mobile hero assignment",
    }),
  );

  await waitFor(() => {
    expect(screen.getByTestId("hero-editor-genres")).toHaveAttribute(
      "data-reload-token",
      "1",
    );
    expect(screen.getByTestId("hero-editor-genres")).toHaveAttribute(
      "data-reload-composition",
      "mobile",
    );
  });
});

it("keeps artwork controls and gallery in the same first tab section frame", () => {
  render(<ArtistArtworkSection artistId={7} artistName="Converge" canEdit />);
  const heading = screen.getByRole("heading", { name: "Artwork" });
  const section = heading.closest('[data-slot="artist-detail-section"]');
  expect(section).not.toHaveClass("border-t", "pt-5.5");
  expect(
    section?.querySelector('[data-slot="artist-detail-header"]'),
  ).toHaveClass("min-h-11", "mb-3", "items-center");
  expect(
    section?.querySelector('[data-slot="artist-detail-body"]'),
  ).toContainElement(screen.getByTestId("artwork-gallery"));
  expect(
    section?.querySelector('[data-slot="artist-detail-actions"]'),
  ).toContainElement(
    screen.getByRole("button", { name: "Backfill eligible artists" }),
  );
});
