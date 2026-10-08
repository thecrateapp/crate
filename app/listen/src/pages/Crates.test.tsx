import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  api: vi.fn(),
  crates: [] as unknown[],
  detail: null as unknown,
}));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api };
});

vi.mock("@crate/ui/lib/use-breakpoint", () => ({ useIsDesktop: () => false }));

vi.mock("@/contexts/PlaylistComposerContext", () => ({
  usePlaylistComposer: () => ({ openCreatePlaylist: vi.fn() }),
  useOptionalPlaylistComposer: () => ({ openCreatePlaylist: vi.fn() }),
}));

import { Crates } from "@/pages/Crates";
import { Library } from "@/pages/Library";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";

const crateId = "7ee76303-7aa6-4317-a5d3-18c2e1360b1c";
const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => navigate };
});

function ownedCrate(name: string, access: "owner" | "collaborator") {
  return {
    id: access === "owner" ? crateId : "5c0f9b3d-8c5b-4cf4-a19a-0c2a881bc0f3",
    owner_id: 1,
    owner_name: "Listener",
    name,
    description: "",
    visibility: "private",
    is_collaborative: true,
    is_ordered: true,
    sort_direction: "asc" as const,
    loop_enabled: false,
    access,
    album_count: 0,
    track_count: 0,
    albums: [],
    first_album: null,
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
  };
}

function renderCrates() {
  return renderWithListenProviders(<Library />, {
    path: "/collection/:section",
    route: "/collection/crates",
    locale: "en",
  });
}

function openCrateEditor() {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit Crate" }));
}

describe("Collection Crates", () => {
  beforeEach(() => {
    mocks.crates = [];
    mocks.detail = null;
    mocks.api.mockReset();
    navigate.mockReset();
    mocks.api.mockResolvedValue({ id: crateId });
    mocks.useApi.mockImplementation((url: string | null) => ({
      data:
        url === "/api/me/crates"
          ? mocks.crates
          : url?.endsWith("/members")
            ? []
            : url?.startsWith("/api/crates/")
              ? mocks.detail
              : null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
  });

  it("shows crates owned by the listener and crates shared with them", () => {
    mocks.crates = [
      ownedCrate("Year-end records", "owner"),
      ownedCrate("Tour picks", "collaborator"),
    ];

    renderCrates();

    expect(
      screen.getByRole("link", { name: "Open Year-end records" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Tour picks" })).toBeVisible();
    expect(screen.getByText("Shared with you")).toBeVisible();
  });

  it("renders Crate cards in the same six-column grid as Albums", () => {
    mocks.crates = [ownedCrate("Year-end records", "owner")];

    renderCrates();

    expect(screen.getByTestId("crate-grid")).toHaveClass(
      "grid-cols-2",
      "sm:grid-cols-3",
      "lg:grid-cols-6",
    );
    expect(screen.getByTestId("crate-card")).toHaveClass("w-full");
    expect(screen.getByRole("button", { name: "New Crate" })).toHaveAttribute(
      "data-slot",
      "button",
    );
  });

  it("notifies the library when a Crate is created", async () => {
    const onCrateChange = vi.fn();

    renderWithListenProviders(<Crates onCrateChange={onCrateChange} />, {
      locale: "en",
    });

    fireEvent.click(screen.getByRole("button", { name: "New Crate" }));
    expect(screen.getByTestId("crate-form")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Year-end records" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Crate" }));

    await waitFor(() => expect(onCrateChange).toHaveBeenCalledOnce());
  });

  it("links the collection card to the Crate detail and keeps Edit in the menu", async () => {
    mocks.crates = [ownedCrate("Year-end records", "owner")];
    mocks.detail = ownedCrate("Year-end records", "owner");

    renderCrates();

    expect(
      screen.getByRole("link", { name: "Open Year-end records" }),
    ).toHaveAttribute("href", `/crate/${crateId}`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    openCrateEditor();

    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "Year-end records",
      }),
    ).toBeVisible();
  });

  it("lists followed Crates with an empty state", () => {
    mocks.crates = [ownedCrate("Year-end records", "owner")];

    renderCrates();

    expect(
      screen.getByRole("heading", { name: "Crates you follow" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Follow public Crates from other listeners to see them here.",
      ),
    ).toBeVisible();
    expect(useApi).toHaveBeenCalledWith("/api/me/crates/followed");
  });

  it("plays the complete Crate from its card", async () => {
    const albumUid = "c43211c0-554a-45c2-ae2d-86cf1fae1d69";
    const playAll = vi.fn();
    const setRepeatMode = vi.fn();
    mocks.crates = [
      {
        ...ownedCrate("Year-end records", "owner"),
        album_count: 1,
        loop_enabled: true,
        albums: [
          {
            global_album_uid: albumUid,
            position: 0,
            name: "Jane Doe",
            artist_name: "Converge",
            has_cover: true,
          },
        ],
      },
    ];
    mocks.api.mockImplementation(async (path: string) => {
      if (path === `/api/crates/${crateId}/playback`) {
        return [
          {
            global_track_uid: "track-uid",
            global_album_uid: albumUid,
            global_artist_uid: "artist-uid",
            title: "First song",
            artist: "Converge",
            album: "Jane Doe",
            duration: 180,
          },
        ];
      }
      return { id: crateId };
    });

    renderWithListenProviders(<Library />, {
      path: "/collection/:section",
      route: "/collection/crates",
      locale: "en",
      playerActions: { playAll, setRepeatMode },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Play Year-end records" }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(`/api/crates/${crateId}/playback`);
      expect(playAll).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            title: "First song",
            artist: "Converge",
            album: "Jane Doe",
          }),
        ],
        0,
        expect.objectContaining({
          type: "crate",
          name: "Year-end records",
          id: crateId,
        }),
      );
      expect(setRepeatMode).toHaveBeenCalledWith("all");
    });
  });

  it("wires shuffle and Crate radio from the contextual menu", async () => {
    const playAll = vi.fn();
    const setRepeatMode = vi.fn();
    mocks.crates = [
      {
        ...ownedCrate("Year-end records", "owner"),
        album_count: 1,
        track_count: 2,
        albums: [],
      },
    ];
    mocks.api.mockImplementation(async (path: string, method?: string) => {
      if (path === `/api/crates/${crateId}/playback`) {
        return [
          {
            global_track_uid: "track-1",
            global_album_uid: "album-1",
            title: "First song",
            artist: "Artist",
            album: "Album",
            duration: 180,
          },
          {
            global_track_uid: "track-2",
            global_album_uid: "album-1",
            title: "Second song",
            artist: "Artist",
            album: "Album",
            duration: 180,
          },
        ];
      }
      if (path === "/api/radio/start" && method === "POST") {
        return {
          session_id: "radio-session",
          seed_label: "Year-end records",
          tracks: [
            {
              track_id: 99,
              title: "Radio song",
              artist: "Artist",
              distance: 0,
            },
          ],
        };
      }
      return { id: crateId };
    });

    renderWithListenProviders(<Library />, {
      path: "/collection/:section",
      route: "/collection/crates",
      locale: "en",
      playerActions: { playAll, setRepeatMode },
    });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Shuffle Crate" }));

    await waitFor(() => {
      expect(playAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: "First song" }),
          expect.objectContaining({ title: "Second song" }),
        ]),
        0,
        expect.objectContaining({ type: "crate" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Start Crate radio" }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/api/radio/start", "POST", {
        mode: "seeded",
        seed_type: "crate",
        seed_value: crateId,
      });
      expect(playAll).toHaveBeenCalledTimes(2);
    });
  });

  it("creates a private Crate with an empty album list", async () => {
    renderCrates();

    fireEvent.click(screen.getByRole("button", { name: "New Crate" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Year-end records" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Crate" }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/api/crates", "POST", {
        name: "Year-end records",
        description: "",
        is_collaborative: false,
        visibility: "private",
        is_ordered: false,
        sort_direction: "asc",
        loop_enabled: false,
      });
    });
    expect(useApi).toHaveBeenCalledWith("/api/me/crates");
  });

  it("creates an unordered Crate when ordering is set to none", async () => {
    const user = userEvent.setup();
    renderCrates();

    await user.click(screen.getByRole("button", { name: "New Crate" }));
    await user.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Unranked favorites",
    );
    await user.click(screen.getByRole("combobox", { name: "Ordering" }));
    await user.click(screen.getByRole("option", { name: "No order" }));
    await user.click(screen.getByRole("button", { name: "Create Crate" }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/api/crates",
        "POST",
        expect.objectContaining({
          name: "Unranked favorites",
          is_ordered: false,
          sort_direction: "asc",
        }),
      );
    });
  });

  it("lets the owner edit visibility and collaboration without invite management", () => {
    mocks.crates = [ownedCrate("Year-end records", "owner")];
    mocks.detail = {
      ...ownedCrate("Year-end records", "owner"),
      albums: [],
    };

    renderCrates();
    openCrateEditor();

    expect(screen.getByTestId("crate-form")).toBeInTheDocument();
    expect(screen.getByLabelText("Visibility")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Allow collaboration" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create collaboration invite" }),
    ).not.toBeInTheDocument();
  });

  it("keeps visibility and invitation controls away from collaborators", () => {
    mocks.crates = [ownedCrate("Tour picks", "collaborator")];
    mocks.detail = {
      ...ownedCrate("Tour picks", "collaborator"),
      albums: [],
    };

    renderCrates();
    openCrateEditor();

    expect(screen.queryByLabelText("Visibility")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create collaboration invite" }),
    ).not.toBeInTheDocument();
  });

  it("searches the catalog and adds an album by its canonical UID", async () => {
    const albumUid = "c43211c0-554a-45c2-ae2d-86cf1fae1d69";
    mocks.crates = [ownedCrate("Year-end records", "owner")];
    mocks.detail = {
      ...ownedCrate("Year-end records", "owner"),
      albums: [],
    };
    mocks.api.mockImplementation(async (path: string, method?: string) => {
      if (path.startsWith("/api/catalog/search")) {
        return {
          albums: [
            {
              global_album_uid: albumUid,
              name: "Jane Doe",
              artist: "Converge",
              year: "2001",
              has_cover: true,
            },
          ],
        };
      }
      if (path === `/api/crates/${crateId}/albums` && method === "POST") {
        return {
          global_album_uid: albumUid,
          position: 0,
          name: "Jane Doe",
          artist_name: "Converge",
          year: "2001",
          has_cover: true,
        };
      }
      return { id: crateId };
    });

    renderCrates();
    openCrateEditor();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search albums" }), {
      target: { value: "Jane Doe" },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Add Jane Doe by Converge" }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        `/api/crates/${crateId}/albums`,
        "POST",
        {
          global_album_uid: albumUid,
        },
      );
    });
  });

  it("persists album order changes by canonical album UID", async () => {
    const firstUid = "5af71c8f-d8c1-4a9c-9f92-5fc3a0c5d4d1";
    const secondUid = "c43211c0-554a-45c2-ae2d-86cf1fae1d69";
    mocks.crates = [ownedCrate("Year-end records", "owner")];
    mocks.detail = {
      ...ownedCrate("Year-end records", "owner"),
      albums: [
        {
          global_album_uid: firstUid,
          position: 0,
          name: "Jane Doe",
          artist_name: "Converge",
          has_cover: false,
        },
        {
          global_album_uid: secondUid,
          position: 1,
          name: "Relationship of Command",
          artist_name: "At the Drive-In",
          has_cover: false,
        },
      ],
    };

    renderCrates();
    openCrateEditor();
    fireEvent.click(screen.getByRole("button", { name: "Move Jane Doe down" }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        `/api/crates/${crateId}/albums/order`,
        "PUT",
        { global_album_uids: [secondUid, firstUid] },
      );
    });
  });
});
