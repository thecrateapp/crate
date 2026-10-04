import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  api: vi.fn(),
  crate: null as unknown,
  dndOnDragEnd: null as
    | ((event: { active: { id: string }; over: { id: string } | null }) => void)
    | null,
}));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api };
});

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: unknown;
    onDragEnd: typeof mocks.dndOnDragEnd;
  }) => {
    mocks.dndOnDragEnd = onDragEnd;
    return children;
  },
  closestCenter: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: unknown }) => children,
  verticalListSortingStrategy: {},
  useSortable: ({ id }: { id: string }) => ({
    attributes: { "data-sortable-id": id },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

import { CrateEditor } from "@/components/CrateEditor";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { CrateDetail } from "@/pages/crates-types";

const crateId = "7ee76303-7aa6-4317-a5d3-18c2e1360b1c";

const editorProps = {
  crateId,
  onBack: vi.fn(),
  onDeleted: vi.fn(),
};

function CrateEditorHarness() {
  const [, setRevision] = useState(0);
  return (
    <>
      <button onClick={() => setRevision((revision) => revision + 1)}>
        Refresh crate snapshot
      </button>
      <CrateEditor {...editorProps} />
    </>
  );
}

function crateDetail(name: string): CrateDetail {
  return {
    id: crateId,
    owner_id: 1,
    name,
    description: "",
    visibility: "private",
    is_collaborative: false,
    is_ordered: true,
    sort_direction: "asc",
    loop_enabled: false,
    access: "owner",
    album_count: 0,
    track_count: 0,
    first_album: null,
    updated_at: null,
    albums: [],
  };
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("CrateEditor", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    mocks.crate = crateDetail("Original name");
    mocks.api.mockReset();
    mocks.dndOnDragEnd = null;
    mocks.useApi.mockImplementation(() => ({
      data: mocks.crate,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
  });

  it("keeps the editable draft when the server snapshot refetches", () => {
    renderWithListenProviders(<CrateEditorHarness />, {
      locale: "en",
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Unsaved name" },
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search albums" }), {
      target: { value: "High" },
    });

    mocks.crate = {
      ...crateDetail("Updated from server"),
      updated_at: "2026-10-02T10:00:00Z",
    };
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh crate snapshot" }),
    );

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Unsaved name",
    );
    expect(
      screen.getByRole("searchbox", { name: "Search albums" }),
    ).toHaveValue("High");
  });

  it("hides reorder controls for unordered Crates", () => {
    mocks.crate = {
      ...crateDetail("Loose records"),
      is_ordered: false,
      albums: [
        {
          global_album_uid: "album-1",
          position: 0,
          name: "First record",
          artist_name: "Listener",
          has_cover: false,
        },
      ],
    };
    renderWithListenProviders(<CrateEditor {...editorProps} />, {
      locale: "en",
    });

    expect(screen.getByText("First record")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Move First record up" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Drag First record to reorder" }),
    ).toBeNull();
  });

  it("uses the same modal surface to edit metadata and manage albums", () => {
    renderWithListenProviders(<CrateEditor {...editorProps} />, {
      locale: "en",
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Albums" })).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Search albums" }),
    ).toBeVisible();
  });

  it("saves the selected ordering mode and loop presentation settings", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    mocks.api.mockResolvedValue({ ok: true });
    renderWithListenProviders(
      <CrateEditor {...editorProps} onBack={onBack} />,
      {
        locale: "en",
      },
    );

    const ordering = screen.getByRole("combobox", { name: "Ordering" });
    expect(ordering).toHaveAttribute("data-slot", "select-trigger");
    await user.click(ordering);
    await user.click(screen.getByRole("option", { name: "Descending" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Loop playback" }));
    fireEvent.submit(
      screen.getByRole("textbox", { name: "Name" }).closest("form")!,
    );

    expect(mocks.api).toHaveBeenCalledWith(
      `/api/crates/${crateId}`,
      "PUT",
      expect.objectContaining({
        is_ordered: true,
        sort_direction: "desc",
        loop_enabled: true,
      }),
    );
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
  });

  it("uses the design-system select for crate visibility", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<CrateEditor {...editorProps} />, {
      locale: "en",
    });

    const visibility = screen.getByRole("combobox", { name: "Visibility" });
    expect(visibility).toHaveAttribute("data-slot", "select-trigger");
    await user.click(visibility);
    await user.click(screen.getByRole("option", { name: "Public" }));

    expect(visibility).toHaveTextContent("Public");
  });

  it("renders the shared CrateForm fields in order for owners", () => {
    renderWithListenProviders(<CrateEditor {...editorProps} />, {
      locale: "en",
    });

    const form = screen.getByTestId("crate-form");
    const labels = Array.from(
      form.querySelectorAll("[data-slot='form-field-label'], [aria-label]"),
      (element) => element.getAttribute("aria-label") ?? element.textContent,
    );
    expect(labels).toEqual([
      "Name",
      "Description",
      "Visibility",
      "Ordering",
      "Loop playback",
      "Allow collaboration",
    ]);
    expect(
      screen.queryByRole("button", { name: "Create collaboration invite" }),
    ).toBeNull();
  });

  it("hides owner-only fields from collaborators and omits them on save", async () => {
    mocks.crate = { ...crateDetail("Shared"), access: "collaborator" };
    mocks.api.mockResolvedValue({ ok: true });
    renderWithListenProviders(<CrateEditor {...editorProps} />, {
      locale: "en",
    });

    expect(screen.queryByRole("combobox", { name: "Visibility" })).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: "Allow collaboration" }),
    ).toBeNull();
    fireEvent.submit(screen.getByTestId("crate-form"));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`/api/crates/${crateId}`, "PUT", {
        name: "Shared",
        description: "",
        is_ordered: true,
        sort_direction: "asc",
        loop_enabled: false,
      }),
    );
  });

  it("persists an album reorder after dragging it over another album", async () => {
    mocks.crate = {
      ...crateDetail("Original name"),
      albums: [
        {
          global_album_uid: "album-a",
          position: 0,
          name: "Album A",
          artist_name: "Artist A",
          has_cover: false,
        },
        {
          global_album_uid: "album-b",
          position: 1,
          name: "Album B",
          artist_name: "Artist B",
          has_cover: false,
        },
        {
          global_album_uid: "album-c",
          position: 2,
          name: "Album C",
          artist_name: "Artist C",
          has_cover: false,
        },
      ],
    };
    mocks.api.mockResolvedValue({});

    renderWithListenProviders(<CrateEditor {...editorProps} />, {
      locale: "en",
    });

    expect(mocks.dndOnDragEnd).not.toBeNull();
    mocks.dndOnDragEnd?.({
      active: { id: "album-a" },
      over: { id: "album-c" },
    });

    expect(mocks.api).toHaveBeenCalledWith(
      `/api/crates/${crateId}/albums/order`,
      "PUT",
      { global_album_uids: ["album-b", "album-c", "album-a"] },
    );
  });
});
