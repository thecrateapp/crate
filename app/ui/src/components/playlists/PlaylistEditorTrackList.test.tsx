import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  PlaylistEditorTrackList,
  type PlaylistEditorTrack,
} from "./PlaylistEditorTrackList";

interface TestTrack extends PlaylistEditorTrack {
  track_id: number;
}

const entries: TestTrack[] = [
  {
    id: 11,
    track_id: 900,
    title: "Echo",
    artist: "A",
    album: "First",
    duration: 0,
    source: "manual",
  },
  {
    id: 12,
    track_id: 900,
    title: "Echo",
    artist: "A",
    album: "First",
    duration: 181,
    locked: true,
    format: "FLAC",
  },
  {
    id: 13,
    track_id: 901,
    title: "Afterglow",
    artist: "B",
    album: "Second",
    duration: null,
    source: null,
    locked: null,
    format: null,
  },
];

function ControlledList({ onReorder }: { onReorder: (ids: number[]) => void }) {
  const [tracks, setTracks] = useState(entries);
  return (
    <PlaylistEditorTrackList
      tracks={tracks}
      onRemove={vi.fn()}
      onReorder={(ids) => {
        onReorder(ids);
        setTracks(ids.map((id) => tracks.find((track) => track.id === id)!));
      }}
    />
  );
}

function entryOrder() {
  return within(screen.getByRole("list", { name: "Playlist tracks" }))
    .getAllByRole("listitem")
    .map((row) => Number(row.getAttribute("data-playlist-entry-id")));
}

describe("PlaylistEditorTrackList", () => {
  it("moves repeated tracks with the keyboard using playlist-entry IDs", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<ControlledList onReorder={onReorder} />);

    screen.getByRole("button", { name: "Move Echo down, position 1" }).focus();
    await user.keyboard("{Enter}");

    expect(onReorder).toHaveBeenLastCalledWith([12, 11, 13]);
    expect(entryOrder()).toEqual([12, 11, 13]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved Echo to position 2.",
    );

    screen
      .getByRole("button", { name: "Move Afterglow up, position 3" })
      .focus();
    await user.keyboard(" ");

    expect(onReorder).toHaveBeenLastCalledWith([12, 13, 11]);
    expect(entryOrder()).toEqual([12, 13, 11]);
    expect(onReorder).toHaveBeenCalledTimes(2);
  });

  it("disables boundary actions and removes the precise occurrence with its one-based position", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    const onRemove = vi.fn();
    render(
      <PlaylistEditorTrackList
        tracks={entries}
        onRemove={onRemove}
        onReorder={onReorder}
      />,
    );

    const firstUp = screen.getByRole("button", {
      name: "Move Echo up, position 1",
    });
    const lastDown = screen.getByRole("button", {
      name: "Move Afterglow down, position 3",
    });
    expect(firstUp).toBeDisabled();
    expect(lastDown).toBeDisabled();
    await user.click(firstUp);
    await user.click(lastDown);
    expect(onReorder).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Remove Echo, position 2" }),
    );
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(entries[1], 2);
    expect(screen.getByRole("status")).toHaveTextContent("Removed Echo.");
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByText("3:01")).toBeInTheDocument();
    expect(screen.getByText("locked")).toBeInTheDocument();
  });

  it("keeps actions unavailable for the entire pending mutation", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onReorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onRemove = vi.fn();
    render(
      <PlaylistEditorTrackList
        tracks={entries}
        onRemove={onRemove}
        onReorder={onReorder}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Move Echo down, position 1" }),
    );

    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Remove Echo, position 2" }),
    );
    expect(onRemove).not.toHaveBeenCalled();
    expect(onReorder).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false");
    expect(
      screen.getByRole("button", { name: "Remove Echo, position 2" }),
    ).toBeEnabled();
  });

  it("blocks drag and actions while the parent is busy", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onReorder = vi.fn();
    render(
      <PlaylistEditorTrackList
        tracks={entries}
        busy
        onRemove={onRemove}
        onReorder={onReorder}
      />,
    );

    for (const row of screen.getAllByRole("listitem"))
      expect(row).toHaveAttribute("draggable", "false");
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Remove Echo, position 1" }),
    );
    expect(onRemove).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...entries[0], id: undefined }, entries[1]],
    [entries[0], { ...entries[1], id: entries[0]!.id }],
  ])(
    "prevents invalid entry identities from corrupting order while preserving removal",
    async (...invalidEntries) => {
      const user = userEvent.setup();
      const onRemove = vi.fn();
      const onReorder = vi.fn();
      render(
        <PlaylistEditorTrackList
          tracks={invalidEntries}
          onRemove={onRemove}
          onReorder={onReorder}
        />,
      );

      for (const button of screen.getAllByRole("button", { name: /^Move / }))
        expect(button).toBeDisabled();
      for (const row of screen.getAllByRole("listitem"))
        expect(row).toHaveAttribute("draggable", "false");
      await user.click(
        screen.getByRole("button", { name: "Remove Echo, position 2" }),
      );
      expect(onRemove).toHaveBeenCalledExactlyOnceWith(invalidEntries[1], 2);
      expect(onReorder).not.toHaveBeenCalled();
    },
  );

  it("preserves desktop drag order without reading an underlying track ID", async () => {
    const onReorder = vi.fn();
    render(<ControlledList onReorder={onReorder} />);
    const rows = screen.getAllByRole("listitem");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };

    fireEvent.dragStart(rows[0]!, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "11");
    fireEvent.dragOver(rows[2]!, { dataTransfer });
    await act(async () => {
      fireEvent.drop(rows[2]!, { dataTransfer });
    });

    expect(onReorder).toHaveBeenCalledExactlyOnceWith([12, 13, 11]);
    expect(entryOrder()).toEqual([12, 13, 11]);
  });

  it("reports rejected mutations and makes retry possible", async () => {
    const user = userEvent.setup();
    const onRemove = vi
      .fn()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(undefined);
    render(
      <PlaylistEditorTrackList
        tracks={entries}
        onRemove={onRemove}
        onReorder={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Remove Echo, position 2" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The track list could not be updated. Try again.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("Removed Echo.");
    await user.click(
      screen.getByRole("button", { name: "Remove Echo, position 2" }),
    );
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Removed Echo.");
  });

  it("uses shared icon action targets with non-native action tooltips", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PlaylistEditorTrackList
        tracks={entries}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    const remove = screen.getByRole("button", {
      name: "Remove Echo, position 2",
    });

    expect(remove).toHaveAttribute("data-size", "icon-lg");
    expect(remove).toHaveAttribute("data-variant", "ghost");
    expect(container.querySelector("[title]")).toBeNull();
    await user.hover(remove);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/^Remove$/);
  });
});
