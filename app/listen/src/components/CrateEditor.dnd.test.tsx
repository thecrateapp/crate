import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  api: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api };
});

import { CrateEditor } from "@/components/CrateEditor";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { CrateDetail } from "@/pages/crates-types";

const crateId = "7ee76303-7aa6-4317-a5d3-18c2e1360b1c";
const ROW_HEIGHT = 64;

const crate: CrateDetail = {
  id: crateId,
  owner_id: 1,
  name: "Ordered records",
  description: "",
  visibility: "private",
  is_collaborative: false,
  is_ordered: true,
  sort_direction: "asc",
  loop_enabled: false,
  access: "owner",
  album_count: 3,
  track_count: 0,
  first_album: null,
  updated_at: null,
  albums: ["A", "B", "C"].map((letter, position) => ({
    global_album_uid: `album-${letter.toLowerCase()}`,
    position,
    name: `Album ${letter}`,
    artist_name: `Artist ${letter}`,
    has_cover: false,
  })),
};

function rowRect(element: Element) {
  const row = element.closest("li");
  const index = row ? Array.from(row.parentElement!.children).indexOf(row) : 0;
  const top = index * ROW_HEIGHT;
  return DOMRect.fromRect({ x: 0, y: top, width: 600, height: ROW_HEIGHT });
}

function renderEditor() {
  renderWithListenProviders(
    <CrateEditor crateId={crateId} onBack={vi.fn()} onDeleted={vi.fn()} />,
    { locale: "en" },
  );
}

describe("CrateEditor album drag handles", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.api.mockResolvedValue({});
    mocks.useApi.mockImplementation(() => ({
      data: crate,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return rowRect(this);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the sortable activator attributes on the handle", () => {
    renderEditor();

    const handle = screen.getByRole("button", {
      name: "Drag Album A to reorder",
    });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("aria-describedby");
    expect(handle).toHaveClass("touch-none");
  });

  it("starts a pointer drag from the handle after the activation distance", () => {
    renderEditor();

    const handle = screen.getByRole("button", {
      name: "Drag Album A to reorder",
    });
    fireEvent.pointerDown(handle, {
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    expect(handle).not.toHaveAttribute("aria-pressed", "true");

    act(() => {
      fireEvent.pointerMove(document, { clientX: 10, clientY: 40 });
    });

    expect(handle).toHaveAttribute("aria-pressed", "true");
    act(() => {
      fireEvent.pointerUp(document, { clientX: 10, clientY: 40 });
    });
  });

  it("reorders albums with the keyboard from the handle", async () => {
    renderEditor();

    const handle = screen.getByRole("button", {
      name: "Drag Album A to reorder",
    });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await waitFor(() => expect(handle).toHaveAttribute("aria-pressed", "true"));
    fireEvent.keyDown(document.activeElement ?? handle, {
      code: "ArrowDown",
      key: "ArrowDown",
    });
    fireEvent.keyDown(document.activeElement ?? handle, {
      code: "Space",
      key: " ",
    });

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        `/api/crates/${crateId}/albums/order`,
        "PUT",
        { global_album_uids: ["album-b", "album-a", "album-c"] },
      ),
    );
  });
});
