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
