import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { SimilarTracksPanel } from "./SimilarTracksPanel";
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({ tracks: [] });
});
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <button onClick={() => setOpen(true)}>Find similar</button>
      <SimilarTracksPanel
        open={open}
        onClose={() => setOpen(false)}
        trackPath="one.flac"
        trackTitle="One"
        artist="Artist"
      />
    </MemoryRouter>
  );
}
it("moves focus into the shared modal and restores it to the opener on Escape", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Find similar" });
  await user.click(opener);
  const close = await screen.findByRole("button", {
    name: "Close similar tracks",
  });
  await waitFor(() => expect(close).toHaveFocus());
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
it("keeps a failed similarity request retryable instead of claiming there are no matches", async () => {
  apiMock.mockRejectedValueOnce(new Error("offline"));
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Find similar" }));
  await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByText("No similar tracks found")).not.toBeInTheDocument();
  apiMock.mockResolvedValueOnce({
    tracks: [
      {
        path: "two.flac",
        title: "Two",
        artist: "Artist",
        album: "Album",
        album_id: 7,
        album_slug: "album",
        artist_slug: "artist",
        duration: 10,
        score: 0.8,
      },
    ],
  });
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("link", { name: /Two/ })).toHaveAttribute(
    "href",
    "/artists/artist/album",
  );
});
