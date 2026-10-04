import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  detail: null as unknown,
  error: null as unknown,
  playback: [] as unknown,
  api: vi.fn(),
  refetch: vi.fn(),
  startShapedRadio: vi.fn(),
  shuffleArray: vi.fn((tracks: unknown[]) => [...tracks].reverse()),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn(),
  }),
}));

vi.mock("@/lib/utils", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return { ...actual, shuffleArray: mocks.shuffleArray };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api, getApiBase: vi.fn(() => "") };
});

vi.mock("@/lib/radio", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/radio")>("@/lib/radio");
  return { ...actual, startShapedRadio: mocks.startShapedRadio };
});

import { Crate } from "@/pages/Crate";
import type { PlayerActionsValue } from "@/contexts/player-context";
import type { OfflineContextValue } from "@/contexts/offline-context";
import { SHARE_REQUEST_EVENT, type SharePayload } from "@/lib/social-share";
import { longPress, pressMenuKey } from "@/test/item-action-gestures";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const crateId = "77777777-7777-4777-8777-777777777777";
const publicRef = "year-end-records-Ab12Cd34";

function crate(access: "public" | "owner" | "collaborator" = "public") {
  return {
    id: crateId,
    short_code: "Ab12Cd34",
    public_ref: publicRef,
    owner_id: 7,
    owner_username: "jane",
    owner_name: "Jane Doe",
    name: "Year-end records",
    description: "Our favorite albums this year.",
    visibility: "public" as const,
    is_collaborative: true,
    is_ordered: true,
    sort_direction: "asc" as const,
    loop_enabled: false,
    access,
    album_count: 2,
    track_count: 2,
    first_album: null,
    albums: [
      {
        global_album_uid: "11111111-1111-4111-8111-111111111111",
        position: 0,
        name: "Blending",
        artist_name: "High Vis",
        year: "2022",
        has_cover: true,
      },
      {
        global_album_uid: "22222222-2222-4222-8222-222222222222",
        position: 1,
        name: "A Light for Attracting Attention",
        artist_name: "The Smile",
        year: "2022",
        has_cover: false,
      },
    ],
  };
}

function renderCrate(
  playerActions?: Partial<PlayerActionsValue>,
  auth?: {
    user?: null | { id: number; email: string; name: string; role: string };
  },
  offline?: Partial<OfflineContextValue>,
) {
  return renderWithListenProviders(<Crate />, {
    path: "/crate/:crateRef",
    route: `/crate/${crateId}`,
    playerActions,
    auth,
    offline,
  });
}

describe("Crate page", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", undefined);
    mocks.detail = crate();
    mocks.error = null;
    mocks.api.mockReset();
    mocks.refetch.mockReset();
    mocks.api.mockResolvedValue({ ok: true });
    mocks.startShapedRadio.mockReset();
    mocks.startShapedRadio.mockResolvedValue({ tracks: [] });
    mocks.playback = [
      {
        global_track_uid: "33333333-3333-4333-8333-333333333333",
        global_album_uid: "11111111-1111-4111-8111-111111111111",
        title: "Track One",
        artist: "High Vis",
        album: "Blending",
        duration: 181,
      },
      {
        global_track_uid: "44444444-4444-4444-8444-444444444444",
        global_album_uid: "22222222-2222-4222-8222-222222222222",
        title: "Track Two",
        artist: "The Smile",
        album: "A Light for Attracting Attention",
        duration: 212,
      },
    ];
    mocks.shuffleArray.mockClear();
    mocks.useApi.mockClear();
    mocks.useApi.mockImplementation((path: string | null) => ({
      data:
        path === null
          ? null
          : path.endsWith("/playback")
            ? mocks.playback
            : path.endsWith("/members")
              ? []
              : mocks.detail,
      loading: false,
      error: mocks.error,
      refetch: mocks.refetch,
    }));
  });

  function albumRow(name: string) {
    return within(screen.getByRole("list")).getByText(name).closest("article")!;
  }

  it("renders Crate albums as canonical album rows with the album menu", async () => {
    renderCrate();

    const row = albumRow("Blending");
    expect(row).toHaveAttribute("data-density", "default");
    fireEvent.contextMenu(row);

    const sheet = await screen.findByRole("dialog", { name: "Actions menu" });
    expect(within(sheet).getByText("Play album")).toBeInTheDocument();
    expect(
      within(sheet).queryByText("Remove from Crate"),
    ).not.toBeInTheDocument();
  });

  it("opens the Crate album menu with a touch long-press and the menu key", async () => {
    const { unmount } = renderCrate();

    await longPress(albumRow("Blending"));
    expect(
      await screen.findByRole("dialog", { name: "Actions menu" }),
    ).toBeInTheDocument();
    unmount();

    renderCrate();
    pressMenuKey(albumRow("Blending"));
    expect(
      await screen.findByRole("dialog", { name: "Actions menu" }),
    ).toBeInTheDocument();
  });

  it("lets editors remove an album from the Crate menu", async () => {
    const user = userEvent.setup();
    mocks.detail = crate("collaborator");
    renderCrate();

    fireEvent.contextMenu(albumRow("Blending"));
    await user.click(
      await screen.findByRole("menuitem", { name: "Remove from Crate" }),
    );

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        `/api/crates/${crateId}/albums/11111111-1111-4111-8111-111111111111`,
        "DELETE",
      ),
    );
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("renders ordered albums and shares the canonical social-preview link", async () => {
    const user = userEvent.setup();
    const shareRequest = vi.fn();
    window.addEventListener(SHARE_REQUEST_EVENT, shareRequest);

    renderCrate();

    expect(
      screen.getByRole("heading", { level: 1, name: "Year-end records" }),
    ).toBeVisible();
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.getByText("A Crate by Jane Doe")).toBeVisible();
    expect(screen.getAllByText("Blending").length).toBeGreaterThan(0);
    expect(screen.getByText("A Light for Attracting Attention")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Edit Crate" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Share Crate" }));

    expect(shareRequest).toHaveBeenCalledOnce();
    const payload = (
      shareRequest.mock.calls[0]![0] as CustomEvent<SharePayload>
    ).detail;
    expect(payload.kind).toBe("crate");
    expect(payload.url).toContain(`/share/crate/${publicRef}`);
    expect(payload.crateIsOrdered).toBe(true);
    expect(payload.imageUrl).toBe(
      `/share/image/crate/${crateId}/album/11111111-1111-4111-8111-111111111111?size=512`,
    );
    expect(payload.crateAlbums).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Blending",
          position: 0,
          imageUrl: `/share/image/crate/${crateId}/album/11111111-1111-4111-8111-111111111111?size=768`,
        }),
      ]),
    );
    window.removeEventListener(SHARE_REQUEST_EVENT, shareRequest);
  });

  it("offers editing only to owners and collaborators", async () => {
    mocks.detail = crate("collaborator");
    renderCrate();
    expect(
      await screen.findByRole("button", { name: "Edit Crate" }),
    ).toBeVisible();
  });

  it("keeps the public page and player shell mounted while editing in a modal", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mocks.detail = crate("owner");
    renderCrate();

    await user.click(screen.getByRole("button", { name: "Edit Crate" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Year-end records" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Play" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeVisible();
  });

  it("exposes Crate radio and offline as secondary actions", async () => {
    const user = userEvent.setup();
    const toggleCrateOffline = vi.fn(async () => "enabled" as const);
    renderCrate(undefined, undefined, { toggleCrateOffline });

    await user.click(screen.getByRole("button", { name: "Start Crate radio" }));
    await user.click(
      screen.getByRole("button", { name: "Make available offline" }),
    );

    expect(mocks.startShapedRadio).toHaveBeenCalledWith(
      "seeded",
      "crate",
      crateId,
    );
    expect(toggleCrateOffline).toHaveBeenCalledWith({
      crateId,
      title: "Year-end records",
    });
  });

  it("lets signed-in visitors follow a public Crate and shows followers", async () => {
    const user = userEvent.setup();
    mocks.detail = { ...crate(), follower_count: 2, is_followed: false };
    renderCrate();

    expect(screen.getByText(/2 followers/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Follow" }));

    expect(mocks.api).toHaveBeenCalledWith(
      `/api/crates/${crateId}/follow`,
      "POST",
    );
    expect(screen.getByRole("button", { name: "Following" })).toBeVisible();
    expect(screen.getByText(/3 followers/)).toBeVisible();
  });

  it("renders follow ahead of the other Crate secondary actions", () => {
    mocks.detail = { ...crate(), is_followed: false };
    renderCrate();

    const labels = within(screen.getByRole("group", { name: "Crate actions" }))
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels[0]).toBe("Follow");
    expect(labels.indexOf("Follow")).toBeLessThan(labels.indexOf("Share"));
  });

  it("rolls back a failed follow without throwing", async () => {
    const user = userEvent.setup();
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderCrate();

    await user.click(screen.getByRole("button", { name: "Follow" }));

    expect(await screen.findByRole("button", { name: "Follow" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Following" }),
    ).not.toBeInTheDocument();
  });

  it("hides follow on Crates the listener owns", () => {
    mocks.detail = crate("owner");
    renderCrate();

    expect(
      screen.queryByRole("button", { name: "Follow" }),
    ).not.toBeInTheDocument();
  });

  it("disables sharing for private Crates", () => {
    mocks.detail = { ...crate("owner"), visibility: "private" as const };
    renderCrate();

    expect(
      screen.getByRole("button", {
        name: "Make this Crate public to share it",
      }),
    ).toBeDisabled();
  });

  it("offers the ZIP download even without offline support", async () => {
    const user = userEvent.setup();
    renderCrate(undefined, undefined, { supported: false });

    await user.click(screen.getByRole("button", { name: "More" }));

    expect(
      screen.getByRole("menuitem", { name: "Download Crate ZIP" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Make available offline" }),
    ).not.toBeInTheDocument();
  });

  it("renders labelled header actions like the album page", () => {
    mocks.detail = crate("owner");
    renderCrate();

    expect(screen.getByTestId("crate-hero")).toBeInTheDocument();
    const secondary = screen.getByRole("group", { name: "Crate actions" });
    expect(
      within(secondary)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Radio", "Offline", "Members", "Edit", "Share", "More"]);
    expect(
      screen.getByRole("group", { name: "Play Crate" }),
    ).toBeInTheDocument();
  });

  it("opens the members modal from the collaborators action", async () => {
    const user = userEvent.setup();
    mocks.detail = crate("owner");
    renderCrate();

    await user.click(screen.getByRole("button", { name: "Collaborators" }));

    expect(
      await screen.findByRole("heading", { name: "Collaborators" }),
    ).toBeVisible();
    expect(mocks.useApi).toHaveBeenCalledWith(`/api/crates/${crateId}/members`);
  });

  it("requests the worker ZIP from the More menu", async () => {
    const user = userEvent.setup();
    mocks.api
      .mockResolvedValueOnce({ status: "pending", task_id: "task-1" })
      .mockResolvedValue({ status: "failed" });
    vi.stubGlobal("EventSource", undefined);
    renderCrate();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Download Crate ZIP" }),
    );

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        `/api/crates/${crateId}/download`,
        "POST",
      ),
    );
  });

  it("numbers descending Crates by rank in the album list", () => {
    mocks.detail = { ...crate(), sort_direction: "desc" as const };
    renderCrate();

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("2");
    expect(rows[0]).toHaveTextContent("A Light for Attracting Attention");
    expect(rows[1]).toHaveTextContent("1");
    expect(rows[1]).toHaveTextContent("Blending");
  });

  it("plays the flattened tracks in order with a Crate source and deep link", async () => {
    const user = userEvent.setup();
    const playAll = vi.fn();
    renderCrate({ playAll });

    await user.click(screen.getByRole("button", { name: "Play" }));

    const [tracks, startIndex, source] = playAll.mock.calls[0]!;
    expect(tracks.map((track: { title: string }) => track.title)).toEqual([
      "Track One",
      "Track Two",
    ]);
    expect(startIndex).toBe(0);
    expect(source).toEqual({
      type: "crate",
      name: "Year-end records",
      id: crateId,
      href: `/crate/${publicRef}`,
    });
  });

  it("applies the Crate loop setting to the player", async () => {
    const user = userEvent.setup();
    const playAll = vi.fn();
    const setRepeatMode = vi.fn();
    mocks.detail = { ...crate(), loop_enabled: true };
    renderCrate({ playAll, setRepeatMode });

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(setRepeatMode).toHaveBeenCalledWith("all");
  });

  it("shuffles the flattened tracks before starting playback", async () => {
    const user = userEvent.setup();
    const playAll = vi.fn();
    renderCrate({ playAll });

    await user.click(screen.getByRole("button", { name: "Shuffle" }));

    const [tracks, startIndex, source] = playAll.mock.calls[0]!;
    expect(mocks.shuffleArray).toHaveBeenCalledOnce();
    expect(tracks.map((track: { title: string }) => track.title)).toEqual([
      "Track Two",
      "Track One",
    ]);
    expect(startIndex).toBe(0);
    expect(source).toMatchObject({
      type: "crate",
      href: `/crate/${publicRef}`,
    });
  });

  it("disables playback controls when the Crate has no playable tracks", async () => {
    mocks.playback = [];
    renderCrate();

    expect(await screen.findByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeDisabled();
  });

  it("shows the full public Crate to anonymous visitors with a sign-in CTA", () => {
    renderCrate(undefined, { user: null });

    expect(
      screen.getByRole("heading", { level: 1, name: "Year-end records" }),
    ).toBeVisible();
    expect(screen.getByTestId("crate-hero")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share Crate" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Sign in to listen" }),
    ).toHaveAttribute(
      "href",
      `/login?return_to=${encodeURIComponent(`/crate/${publicRef}`)}`,
    );
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Shuffle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Start Crate radio" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Blending/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Back to Crates")).not.toBeInTheDocument();
    expect(mocks.useApi).not.toHaveBeenCalledWith(
      `/api/crates/${crateId}/playback`,
    );
    expect(
      document.querySelector(
        `img[src*="/share/image/crate/${crateId}/album/"]`,
      ),
    ).not.toBeNull();
  });

  it("replaces UUID links with the canonical slug URL and keeps mutations on the id", async () => {
    const user = userEvent.setup();
    renderCrate();

    await waitFor(() =>
      expect(mocks.useApi).toHaveBeenCalledWith(`/api/crates/${publicRef}`),
    );
    expect(mocks.useApi).toHaveBeenCalledWith(
      `/api/crates/${crateId}/playback`,
    );
    await user.click(screen.getByRole("button", { name: "Follow" }));
    expect(mocks.api).toHaveBeenCalledWith(
      `/api/crates/${crateId}/follow`,
      "POST",
    );
  });

  it("does not reveal metadata when a private crate is inaccessible", async () => {
    mocks.detail = null;
    mocks.error = new Error("not found");
    renderCrate();
    expect(await screen.findByText("This Crate is unavailable.")).toBeVisible();
    expect(screen.queryByText("Year-end records")).not.toBeInTheDocument();
  });
});
