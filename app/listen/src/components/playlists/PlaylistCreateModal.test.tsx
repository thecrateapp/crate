import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
  }),
  verticalListSortingStrategy: {},
  arrayMove: vi.fn((items: unknown[]) => items),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => ""),
    },
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: vi.fn(),
  };
});

import { PlaylistCreateModal } from "@/components/playlists/PlaylistCreateModal";
import { I18nProvider } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PlaylistCreateModal", () => {
  it("uses the Listen glass panel surface", () => {
    render(
      <I18nProvider initialLocale="en">
        <PlaylistCreateModal
          open
          initialTracks={[]}
          submitting={false}
          onClose={vi.fn()}
          onSubmit={vi.fn(async () => {})}
        />
      </I18nProvider>,
    );

    expect(
      screen
        .getByRole("heading", { name: "Create playlist" })
        .closest(".listen-glass-panel"),
    ).toBeInTheDocument();
  });

  it("adds global catalog tracks to the submit payload", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({
      tracks: [
        {
          title: "Talk For Hours",
          artist: "High Vis",
          album: "Blending",
          duration: 183,
          global_track_uid: "track-global-1",
        },
      ],
    });
    const onSubmit = vi.fn(async () => {});

    render(
      <I18nProvider initialLocale="en">
        <PlaylistCreateModal
          open
          initialTracks={[]}
          submitting={false}
          onClose={vi.fn()}
          onSubmit={onSubmit}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Search tracks to add"), {
      target: { value: "high vis" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/api/catalog/search?q=high%20vis&limit=20",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /Talk For Hours/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add a title" }));
    fireEvent.change(screen.getByPlaceholderText("My next obsession"), {
      target: { value: "Favourites" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create playlist" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tracks: [
            expect.objectContaining({
              globalTrackUid: "track-global-1",
            }),
          ],
        }),
      );
    });
  });
});
