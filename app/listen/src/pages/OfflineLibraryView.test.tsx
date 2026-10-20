import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { OfflineLibraryView } from "./OfflineLibraryView";
it("names local playback by track and artist in a valid keyboard-accessible list", async () => {
  const play = vi.fn();
  renderWithListenProviders(
    <OfflineLibraryView
      groups={[
        {
          key: "album:1",
          title: "Saved album",
          tracks: [{ id: "track1", title: "Marea", artist: "Costa Norte" }],
        },
      ]}
      currentTrack={null}
      isPlaying={false}
      isBuffering={false}
      onPlay={play}
      onPause={() => {}}
      onResume={() => {}}
      onPrevious={() => {}}
      onNext={() => {}}
      progress={null}
    />,
  );
  const list = screen.getByRole("list", { name: "Saved album" });
  const item = within(list).getByRole("listitem");
  expect(
    within(item).getByRole("button", { name: "Play Marea — Costa Norte" }),
  ).toBeVisible();
  await userEvent.click(
    within(item).getByRole("button", { name: "Play Marea — Costa Norte" }),
  );
  expect(play).toHaveBeenLastCalledWith(0, 0);
  fireEvent.keyDown(item, { key: "Enter" });
  expect(play).toHaveBeenCalledTimes(2);
});

it("keeps saved per-track quality and duration in canonical slots without inventing missing metadata", () => {
  renderWithListenProviders(
    <OfflineLibraryView
      groups={[
        {
          key: "album:1",
          title: "Saved album",
          tracks: [
            {
              id: "lossless",
              title: "First Song",
              artist: "Mixed Case Artist",
              duration: 75,
              format: "flac",
              sampleRate: 44100,
              bitDepth: 16,
            },
            {
              id: "lossy",
              title: "Second Song",
              artist: "Mixed Case Artist",
              duration: 120,
              format: "mp3",
              bitrate: 320,
            },
            {
              id: "missing",
              title: "Unknown details",
              artist: "Another Artist",
            },
          ],
        },
      ]}
      currentTrack={{
        id: "lossless",
        title: "First Song",
        artist: "Mixed Case Artist",
      }}
      isPlaying={false}
      isBuffering={false}
      onPlay={() => {}}
      onPause={() => {}}
      onResume={() => {}}
      onPrevious={() => {}}
      onNext={() => {}}
      progress={null}
    />,
    { locale: "en" },
  );
  const rows = within(
    screen.getByRole("list", { name: "Saved album" }),
  ).getAllByRole("listitem");
  expect(
    within(rows[0]!).getByText("FLAC 16/44.1").closest("[data-quality-tier]"),
  ).toHaveAttribute("data-quality-tier", "lossless");
  expect(
    rows[0]!.querySelector('[data-track-slot="duration"]'),
  ).toHaveTextContent("1:15");
  expect(within(rows[1]!).getByText("MP3 320")).toBeInTheDocument();
  expect(
    rows[1]!.querySelector('[data-track-slot="duration"]'),
  ).toHaveTextContent("2:00");
  expect(
    rows[2]!.querySelector('[data-track-slot="quality"]'),
  ).toBeEmptyDOMElement();
  expect(
    rows[2]!.querySelector('[data-track-slot="duration"]'),
  ).toBeEmptyDOMElement();
  expect(
    within(screen.getByRole("region", { name: "Queue" })).getByText(
      "Mixed Case Artist",
    ),
  ).not.toHaveClass("font-mono");
});

it("displays track artwork without changing the48px row media geometry", () => {
  renderWithListenProviders(
    <OfflineLibraryView
      groups={[
        {
          key: "album:7",
          title: "Album",
          tracks: [
            {
              id: "one",
              title: "Covered song",
              artist: "Artist",
              albumCover: "data:image/png;base64,test",
            },
          ],
        },
      ]}
      currentTrack={null}
      isPlaying={false}
      isBuffering={false}
      onPlay={() => {}}
      onPause={() => {}}
      onResume={() => {}}
      onPrevious={() => {}}
      onNext={() => {}}
      progress={null}
    />,
  );
  expect(screen.getByRole("img", { name: "Covered song" })).toHaveAttribute(
    "src",
    "data:image/png;base64,test",
  );
});
