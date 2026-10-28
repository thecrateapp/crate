import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";

const drag = vi.hoisted(() => ({
  onDragEnd: null as ((event: DragEndEvent) => void) | null,
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: (event: DragEndEvent) => void;
  }) => {
    drag.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  closestCenter: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", async (original) => ({
  ...(await original<typeof import("@dnd-kit/sortable")>()),
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
  }),
  verticalListSortingStrategy: {},
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
  vi.mocked(api).mockReset();
});

describe("PlaylistCreateModal", () => {
  it("retains all edited fields and track membership during a refresh of the same playlist", async () => {
    const onSubmit = vi.fn(async () => {});
    vi.mocked(api).mockResolvedValue({
      tracks: [
        {
          title: "Added draft",
          artist: "Band",
          album: "Record",
          duration: 180,
          global_track_uid: "added",
        },
      ],
    });
    const tracks = [
      {
        title: "First",
        artist: "Band",
        globalTrackUid: "a",
        playlistEntryId: 1,
      },
      {
        title: "Second",
        artist: "Band",
        globalTrackUid: "b",
        playlistEntryId: 2,
      },
      {
        title: "Third",
        artist: "Band",
        globalTrackUid: "c",
        playlistEntryId: 3,
      },
    ];
    const props = {
      open: true,
      mode: "edit" as const,
      editorIdentity: 10,
      initialName: "Original",
      initialDescription: "Original description",
      initialCoverDataUrl: "data:image/png;base64,original",
      initialTracks: tracks,
      submitting: false,
      onClose: vi.fn(),
      onSubmit,
    };
    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <PlaylistCreateModal {...props} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Playlist" }));
    fireEvent.change(screen.getByPlaceholderText("My next obsession"), {
      target: { value: "Unsaved draft" },
    });
    fireEvent.blur(screen.getByPlaceholderText("My next obsession"));
    fireEvent.click(screen.getByRole("button", { name: "Description" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Unsaved description" },
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Description" }));
    act(() =>
      drag.onDragEnd?.({
        active: { id: "entry:2" },
        over: { id: "entry:1" },
      } as DragEndEvent),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Third" }));
    fireEvent.click(screen.getByRole("switch", { name: /Collaborative/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Use collage instead" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Search tracks to add"), {
      target: { value: "Added" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Add: Added draft" }),
    );
    rerender(
      <I18nProvider initialLocale="en">
        <PlaylistCreateModal
          {...props}
          initialName="Server refresh"
          initialTracks={tracks.map((track) => ({ ...track }))}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Playlist" })).toHaveTextContent(
      "Unsaved draft",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Unsaved draft",
          description: "Unsaved description",
          coverDataUrl: null,
          isCollaborative: true,
          tracks: [
            tracks[1],
            tracks[0],
            expect.objectContaining({
              title: "Added draft",
              globalTrackUid: "added",
            }),
          ],
        }),
      ),
    );
  });

  it("starts a fresh draft on reopen and when another playlist is selected", () => {
    const props = {
      open: true,
      mode: "edit" as const,
      editorIdentity: 10,
      initialName: "Original",
      initialTracks: [],
      submitting: false,
      onClose: vi.fn(),
      onSubmit: vi.fn(async () => {}),
    };
    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <PlaylistCreateModal {...props} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Playlist" }));
    fireEvent.change(screen.getByPlaceholderText("My next obsession"), {
      target: { value: "Unsaved" },
    });
    rerender(
      <I18nProvider initialLocale="en">
        <PlaylistCreateModal {...props} open={false} />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider initialLocale="en">
        <PlaylistCreateModal {...props} initialName="Latest original" />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Playlist" })).toHaveTextContent(
      "Latest original",
    );
    rerender(
      <I18nProvider initialLocale="en">
        <PlaylistCreateModal
          {...props}
          editorIdentity={11}
          initialName="Another playlist"
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Playlist" })).toHaveTextContent(
      "Another playlist",
    );
  });

  it("shows catalog read failure with Retry instead of an empty result", async () => {
    vi.useFakeTimers();
    vi.mocked(api)
      .mockRejectedValueOnce(new Error("Catalog unavailable"))
      .mockResolvedValueOnce({
        tracks: [
          {
            title: "Recovered",
            artist: "Band",
            album: "Record",
            duration: 180,
            global_track_uid: "recovered",
          },
        ],
      });
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
    fireEvent.change(screen.getByPlaceholderText("Search tracks to add"), {
      target: { value: "Band" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No tracks found")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: /Recovered/ }),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("uses the shared modal panel surface", () => {
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
        .closest("[data-app-modal-panel]"),
    ).toHaveClass("crate-overlay-panel");
    expect(
      screen.getByRole("dialog").querySelector(".crate-overlay-footer"),
    ).not.toHaveClass("bg-transparent");
    expect(
      screen.getByRole("dialog").querySelector(".listen-glass-panel"),
    ).toBeNull();
  });

  it("uses a labelled Select for visibility and an inline collaboration switch", () => {
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
      screen.getByRole("combobox", { name: "Visibility" }),
    ).toHaveAttribute("data-slot", "select-trigger");
    expect(
      screen.getByRole("switch", { name: /Collaborative/i }),
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
          global_album_uid: "album-global-1",
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

    expect(
      screen.getByPlaceholderText("Search tracks to add").className,
    ).not.toMatch(/md:text-base|bg-text-primary\/5/);
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
    const result = screen.getByRole("button", { name: /Talk For Hours/i });
    expect(result.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("album-global-1"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Talk For Hours/i }));
    const selected = screen
      .getByRole("button", { name: "Remove Talk For Hours" })
      .closest('[data-slot="entity-row"]')!;
    expect(selected.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("album-global-1"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Playlist" }));
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
