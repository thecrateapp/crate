import { fireEvent, screen, waitFor } from "@testing-library/react";
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
}));

import { Library } from "@/pages/Library";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";

const crateId = "7ee76303-7aa6-4317-a5d3-18c2e1360b1c";

function ownedCrate(name: string, access: "owner" | "collaborator") {
  return {
    id: access === "owner" ? crateId : "5c0f9b3d-8c5b-4cf4-a19a-0c2a881bc0f3",
    owner_id: 1,
    owner_name: "Listener",
    name,
    description: "",
    visibility: "private",
    is_collaborative: true,
    access,
    album_count: 0,
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

describe("Collection Crates", () => {
  beforeEach(() => {
    mocks.crates = [];
    mocks.detail = null;
    mocks.api.mockReset();
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
      screen.getByRole("button", { name: "Open Year-end records" }),
    ).toBeVisible();
    expect(screen.getByText("Tour picks")).toBeVisible();
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
      });
    });
    expect(useApi).toHaveBeenCalledWith("/api/me/crates");
  });

  it("lets the owner edit visibility and create collaboration invites", () => {
    mocks.crates = [ownedCrate("Year-end records", "owner")];
    mocks.detail = {
      ...ownedCrate("Year-end records", "owner"),
      albums: [],
    };

    renderCrates();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Year-end records" }),
    );

    expect(screen.getByLabelText("Visibility")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create collaboration invite" }),
    ).toBeVisible();
  });

  it("keeps visibility and invitation controls away from collaborators", () => {
    mocks.crates = [ownedCrate("Tour picks", "collaborator")];
    mocks.detail = {
      ...ownedCrate("Tour picks", "collaborator"),
      albums: [],
    };

    renderCrates();
    fireEvent.click(screen.getByRole("button", { name: "Open Tour picks" }));

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
    fireEvent.click(
      screen.getByRole("button", { name: "Open Year-end records" }),
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Search albums" }), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find albums" }));

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

  it("requires collaboration to be saved before creating an invite", async () => {
    mocks.crates = [ownedCrate("Year-end records", "owner")];
    mocks.detail = {
      ...ownedCrate("Year-end records", "owner"),
      is_collaborative: false,
      albums: [],
    };
    mocks.api.mockImplementation(async (path: string, method?: string) => {
      if (path.endsWith("/invites") && method === "POST") {
        return { join_url: "/crate/invite/invite-token" };
      }
      return { id: crateId };
    });

    renderCrates();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Year-end records" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow collaboration" }),
    );

    const inviteButton = screen.getByRole("button", {
      name: "Create collaboration invite",
    });
    expect(inviteButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(inviteButton).toBeEnabled());
    fireEvent.click(inviteButton);

    expect(
      await screen.findByRole("textbox", {
        name: "Collaboration invite link",
      }),
    ).toHaveValue("http://localhost:3000/crate/invite/invite-token");
    expect(api).toHaveBeenCalledWith(
      `/api/crates/${crateId}/invites`,
      "POST",
      {},
    );
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
    fireEvent.click(
      screen.getByRole("button", { name: "Open Year-end records" }),
    );
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
