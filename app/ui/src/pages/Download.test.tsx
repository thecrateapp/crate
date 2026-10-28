import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";

const {
  refetch,
  mockApi,
  mockSurface,
  mockArtistAlbums,
  mockArtistSuggestions,
  mockUseApi,
} = vi.hoisted(() => ({
  refetch: vi.fn(),
  mockApi: vi.fn(),
  mockUseApi: vi.fn(),
  mockSurface: {
    tidal_authenticated: true,
    tidal_queue: [
      {
        id: 41,
        tidal_url: "https://tidal.example/album/signal-fire",
        title: "Signal Fire",
        artist: "Caspian",
        status: "downloading",
        source: "tidal",
        quality: "max",
        cover_url: null,
        created_at: "2026-10-22T09:45:00Z",
      },
      {
        id: 42,
        tidal_url: "https://tidal.example/album/on-circles",
        title: "On Circles",
        artist: "Caspian",
        status: "wishlist",
        source: "tidal",
        quality: "high",
        cover_url: null,
        created_at: "2026-10-21T15:30:00Z",
      },
      {
        id: 43,
        tidal_url: "https://tidal.example/album/old-moon",
        title: "Old Moon",
        artist: "Caspian",
        status: "completed",
        source: "tidal",
        quality: "max",
        cover_url: null,
        created_at: "2026-10-20T12:00:00Z",
      },
      {
        id: 44,
        tidal_url: "https://tidal.example/album/quiet-sky",
        title: "Quiet Sky",
        artist: "Caspian",
        status: "failed",
        source: "tidal",
        quality: "high",
        cover_url: null,
        created_at: "2026-10-19T12:00:00Z",
      },
    ],
    soulseek_queue: [
      {
        source: "soulseek",
        artist: "Caspian",
        album: "Dust and Disquiet",
        filename: "Separation No. 2.flac",
        status: "Downloading",
        progress: 42,
        username: "northstar",
        speed: 2_097_152,
      },
    ],
  },
  mockArtistAlbums: {
    artist_name: "Caspian",
    albums: [
      {
        id: "on-circles",
        title: "On Circles",
        artist: "Caspian",
        year: "2020",
        tracks: 10,
        cover: null,
        url: "https://tidal.example/album/on-circles",
        quality: ["HIRES_LOSSLESS"],
        duration: 2700,
        release_date: "2020-02-07",
        type: "ALBUM",
        status: "local",
        local_quality: { format: "flac", bit_depth: 16, sample_rate: 44100 },
        local_album_id: 510,
      },
      {
        id: "waking-season",
        title: "Waking Season",
        artist: "Caspian",
        year: "2012",
        tracks: 10,
        cover: null,
        url: "https://tidal.example/album/waking-season",
        quality: ["LOSSLESS"],
        duration: 2600,
        release_date: "2012-09-25",
        type: "ALBUM",
        status: "local",
        local_quality: { format: "flac", bit_depth: 16, sample_rate: 44100 },
        local_album_id: 511,
      },
      {
        id: "dust-and-disquiet",
        title: "Dust and Disquiet",
        artist: "Caspian",
        year: "2015",
        tracks: 11,
        cover: null,
        url: "https://tidal.example/album/dust-and-disquiet",
        quality: ["LOSSLESS"],
        duration: 3200,
        release_date: "2015-09-25",
        type: "ALBUM",
        status: "available",
      },
    ],
  },
  mockArtistSuggestions: {
    suggestions: [
      {
        id: 71,
        artist_name: "Drowse",
        artist_url: "https://example.test/artists/drowse",
        note: "Several listeners requested the new release.",
        status: "open",
        created_by_name: "Mara",
        supporter_count: 3,
      },
    ],
  },
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: mockUseApi,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function defaultRead(path: string) {
  return {
    data:
      path === "/api/acquisition/snapshot"
        ? mockSurface
        : path === "/api/tidal/artists/artist-caspian/albums"
          ? mockArtistAlbums
          : path === "/api/acquisition/artist-suggestions"
            ? mockArtistSuggestions
            : null,
    loading: false,
    error: null,
    refetch,
  };
}
vi.mock("@/lib/api", () => ({
  api: mockApi,
  apiSseUrl: (path: string) => path,
}));

import { DownloadPage } from "./Download";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseApi.mockImplementation(defaultRead);
  sessionStorage.clear();
  mockApi.mockReset();
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/tidal/search") && path.includes("q=Caspian"))
      return {
        albums: [],
        artists: [{ id: "artist-caspian", name: "Caspian", picture: null }],
        tracks: [
          {
            id: "track-dewy",
            title: "Dewy",
            artist: "Caspian",
            album: "On Circles",
            duration: 245,
            url: "https://tidal.example/track/dewy",
            quality: ["LOSSLESS"],
          },
        ],
      };
    if (path.startsWith("/api/tidal/search"))
      return { albums: [], artists: [], tracks: [] };
    if (path === "/api/acquisition/search/soulseek")
      return { search_id: "sample-search" };
    if (path === "/api/acquisition/upload")
      return { task_id: "sample-task-id" };
    return undefined;
  });
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("does not claim disconnection or an empty queue while acquisition is unknown", async () => {
  mockUseApi.mockImplementation((path: string) =>
    path === "/api/acquisition/snapshot"
      ? { data: null, loading: true, error: null, refetch }
      : defaultRead(path),
  );
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  expect(screen.queryByText("Tidal disconnected")).toBeNull();
  expect(screen.queryByText("0 active downloads")).toBeNull();
  await userEvent.click(screen.getByRole("tab", { name: /Queue/ }));
  expect(
    screen.getByRole("status", { name: "Loading acquisition queue" }),
  ).toBeVisible();
  expect(screen.queryByText("Queue is clear")).toBeNull();
});

it("offers recovery when loading an album tracklist fails", async () => {
  let attempts = 0;
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/tidal/search"))
      return { albums: [mockArtistAlbums.albums[0]], artists: [], tracks: [] };
    if (path.endsWith("/tracks")) {
      if (attempts++ === 0) throw new Error("offline");
      return {
        tracks: [
          {
            id: "recovered",
            title: "Recovered track",
            artist: "Caspian",
            track_number: 1,
            duration: 60,
            url: "https://tidal.test/track",
            quality: [],
          },
        ],
      };
    }
    return { search_id: "sample-search" };
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  await user.type(
    screen.getByRole("searchbox", { name: "Search music" }),
    "Caspian",
  );
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.click(await screen.findByRole("button", { name: "View tracks" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load album tracks",
  );
  expect(screen.queryByText("No tracks found")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Recovered track")).toBeVisible();
});

it("reports partial wishlist promotion instead of claiming the whole batch succeeded", async () => {
  const surface = {
    ...mockSurface,
    tidal_queue: [
      ...mockSurface.tidal_queue,
      { ...mockSurface.tidal_queue[1], id: 45, title: "Second wish" },
    ],
  };
  mockUseApi.mockImplementation((path: string) =>
    path === "/api/acquisition/snapshot"
      ? { ...defaultRead(path), data: surface }
      : defaultRead(path),
  );
  mockApi.mockImplementation(async (path: string) => {
    if (path.endsWith("/42")) throw new Error("offline");
    return {};
  });
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("tab", { name: /Wishlist/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "Download all (2)" }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "1 queued · 1 failed. Failed items remain in Wishlist.",
    ),
  );
  expect(screen.getByRole("article", { name: "On Circles" })).toBeVisible();
  expect(screen.queryByRole("article", { name: "Second wish" })).toBeNull();
});

it("keeps failed wishlist promotions visible and never announces success", async () => {
  mockApi.mockRejectedValue(new Error("network unavailable"));
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Wishlist/ }));
  await user.click(screen.getByRole("button", { name: "Download all (1)" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.getByRole("article", { name: "On Circles" })).toBeVisible();
});

it("clears and disconnects Soulseek results when a new search is below its minimum", async () => {
  const streams: {
    url: string;
    onmessage: ((event: MessageEvent) => void) | null;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal("EventSource", function (url: string) {
    const stream = { url, onmessage: null, close: vi.fn() };
    streams.push(stream);
    return stream;
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  const search = screen.getByRole("searchbox", { name: "Search music" });
  await user.type(search, "Caspian");
  await user.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() =>
    expect(
      streams.some((stream) => stream.url.includes("sample-search/stream")),
    ).toBe(true),
  );
  const old = streams.find((stream) =>
    stream.url.includes("sample-search/stream"),
  )!;
  act(() =>
    old.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          results: [
            {
              username: "old-peer",
              artist: "Caspian",
              album: "Obsolete Soulseek release",
              quality: "FLAC",
              files: [],
              totalSize: 1,
              speed: 0,
              freeSlot: true,
            },
          ],
          isComplete: false,
        }),
      }),
    ),
  );
  await user.clear(search);
  await user.type(search, "PJ");
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.click(screen.getByRole("tab", { name: /Soulseek/ }));
  expect(screen.queryByText("Obsolete Soulseek release")).toBeNull();
  expect(old.close).toHaveBeenCalled();
});

it("keeps Tidal artist browsing and release actions accessible without hover", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );

  await user.type(
    screen.getByRole("searchbox", { name: "Search music" }),
    "Caspian",
  );
  await user.click(screen.getByRole("button", { name: "Search" }));
  const artistsHeading = await screen.findByRole("heading", {
    name: "Artists",
  });
  const tracksHeading = screen.getByRole("heading", { name: "Tracks" });
  expect(artistsHeading.querySelector("svg")).toBeNull();
  expect(tracksHeading.querySelector("svg")).toBeNull();
  const artistResult = screen.getByRole("button", { name: /browse albums/i });
  expect(artistResult).toHaveClass("bg-raised-surface");
  expect(within(artistResult).getByText("C", { exact: true })).toBeVisible();
  const wishlistTrack = screen.getByRole("button", {
    name: "Add Dewy to wishlist",
  });
  expect(wishlistTrack).not.toHaveAttribute("title");
  expect(wishlistTrack).not.toHaveClass("opacity-0");
  expect(wishlistTrack).toHaveClass(
    "pointer-fine:opacity-0",
    "pointer-fine:group-focus-within:opacity-100",
  );
  await user.hover(wishlistTrack);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Add to wishlist",
  );

  await user.click(wishlistTrack);
  expect(mockApi).toHaveBeenCalledWith(
    "/api/tidal/wishlist",
    "POST",
    expect.objectContaining({ title: "Dewy", content_type: "track" }),
  );
  await user.click(artistResult);

  expect(
    await screen.findByRole("heading", { name: "Caspian on Tidal" }),
  ).toBeVisible();
  expect(screen.getByText("3 albums")).toBeVisible();
  const localAlbum = screen.getByRole("article", {
    name: "On Circles Tidal album",
  });
  expect(localAlbum).toHaveTextContent("Upgrade available");
  expect(within(localAlbum).getByText("O", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Get upgrade" })).toBeVisible();
  expect(
    within(localAlbum).getByRole("button", { name: "View tracks" }),
  ).toBeVisible();
  expect(
    within(localAlbum).getByRole("button", { name: "Wishlist" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Download 1 missing album" }),
  ).toBeVisible();
});

it("keeps an unavailable artist discography distinct from zero albums", async () => {
  mockUseApi.mockImplementation((path: string) =>
    path.includes("/api/tidal/artists/")
      ? { data: null, loading: false, error: "offline", refetch }
      : defaultRead(path),
  );
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  await user.type(
    screen.getByRole("searchbox", { name: "Search music" }),
    "Caspian",
  );
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.click(
    await screen.findByRole("button", { name: /browse albums/i }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Could not load Tidal artist albums",
  );
  expect(screen.queryByText("0 albums")).toBeNull();
});

it("keeps Download's five real panels reachable after the shared tab restyle", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  const workspaceTabs = within(screen.getAllByRole("tablist")[0]!);
  expect(workspaceTabs.getAllByRole("tab")).toHaveLength(5);
  expect(
    screen.getByRole("tabpanel", { name: "Search Results" }),
  ).toBeVisible();
  screen.getByRole("tab", { name: "Search Results" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Upload" })).toHaveFocus();
  expect(screen.getByRole("tabpanel", { name: "Upload" })).toHaveTextContent(
    "Add music",
  );
  await user.keyboard("{ArrowRight}");
  expect(
    screen.getByRole("region", { name: "Active downloads" }),
  ).toBeVisible();
  await user.keyboard("{ArrowRight}");
  expect(
    screen.getByRole("region", { name: "Download wishlist" }),
  ).toBeVisible();
  await user.keyboard("{End}");
  expect(
    screen.getByRole("region", { name: "Download history" }),
  ).toBeVisible();
  await user.keyboard("{Home}");
  expect(
    screen.getByRole("tabpanel", { name: "Search Results" }),
  ).toBeVisible();
});

it("explains which sources the acquisition controls affect", async () => {
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "Acquisition" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Music search" })).toBeVisible();
  expect(
    screen.getByRole("searchbox", { name: "Search music" }),
  ).toHaveAttribute("placeholder", "Artist, album, or track");
  expect(
    screen.getByText(/Used for Tidal downloads and wishlist items/),
  ).toBeVisible();
  expect(
    screen.getByRole("radiogroup", { name: "Tidal download quality" }),
  ).toBeVisible();
  expect(
    screen.getByRole("tablist", { name: "Search result provider" }),
  ).toBeVisible();
});

it("keeps the acquisition search field, icon, and action aligned", () => {
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );

  const form = screen.getByRole("form", { name: "Acquisition search" });
  const input = within(form).getByRole("searchbox", { name: "Search music" });
  const button = within(form).getByRole("button", { name: "Search" });

  expect(form).toHaveClass("items-stretch");
  expect(input.closest('[data-slot="search-input"]')).not.toBeNull();
  expect(input).toHaveClass("crate-form-control");
  expect(button).toHaveClass("h-10", "pointer-coarse:min-h-11");
});

it("submits the music search from the search form", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );

  await user.type(
    screen.getByRole("searchbox", { name: "Search music" }),
    "Caspian",
  );
  await user.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => {
    expect(mockApi).toHaveBeenCalledWith(
      "/api/tidal/search?q=Caspian&limit=20",
      "GET",
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
  expect(
    await screen.findByRole("button", { name: /browse albums/i }),
  ).toBeVisible();
});

it("presents listener suggestions as solid, actionable acquisition cards", () => {
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );

  const suggestions = screen.getByRole("region", {
    name: "Listener suggestions",
  });
  expect(suggestions).toHaveTextContent("1 open");
  const drowse = within(suggestions).getByRole("article", {
    name: "Drowse artist suggestion",
  });
  expect(drowse).toHaveTextContent("3 requests");
  expect(drowse).toHaveTextContent("Suggested by Mara");
  expect(
    within(drowse).getByRole("button", { name: "Search artist" }),
  ).toBeVisible();
  expect(
    within(drowse).getByRole("link", { name: "Open link" }),
  ).toHaveAttribute("href", "https://example.test/artists/drowse");
  expect(within(drowse).getByRole("button", { name: "Dismiss" })).toBeVisible();
});

it("accepts dropped files and shows a user-facing queued state", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("tab", { name: "Upload" }));

  const dropzone = screen.getByRole("group", { name: "Upload music files" });
  const file = new File(["audio"], "Caspian.flac", { type: "audio/flac" });
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

  expect(screen.getByText("Caspian.flac")).toBeVisible();
  expect(screen.getByText("1 file ready to import")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Add to library" }));

  await waitFor(() => {
    expect(mockApi).toHaveBeenCalledWith(
      "/api/acquisition/upload",
      "POST",
      expect.any(FormData),
    );
  });
  expect(screen.getByRole("status")).toHaveTextContent("Upload queued");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Follow its progress from the Queue tab.",
  );
  expect(screen.getByRole("status")).not.toHaveTextContent("sample-task-id");
});

it("keeps queue, wishlist, and history actions attached to their existing records", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("tab", { name: /Queue/ }));
  const queuePanel = screen.getByRole("region", { name: "Active downloads" });
  expect(
    within(queuePanel).getByRole("article", { name: "Signal Fire" }),
  ).toBeVisible();
  expect(
    within(queuePanel).getByRole("progressbar", {
      name: "Dust and Disquiet download progress",
    }),
  ).toHaveAttribute("aria-valuenow", "42");

  await user.click(screen.getByRole("tab", { name: /Wishlist/ }));
  const wishlistPanel = screen.getByRole("region", {
    name: "Download wishlist",
  });
  expect(
    within(wishlistPanel).getByRole("article", { name: "On Circles" }),
  ).toBeVisible();
  const removeWishlistItem = within(wishlistPanel).getByRole("button", {
    name: "Remove On Circles from acquisition",
  });
  expect(removeWishlistItem).not.toHaveAttribute("title");
  expect(removeWishlistItem).toHaveClass("text-text-muted");
  await user.click(removeWishlistItem);
  expect(mockApi).toHaveBeenCalledWith("/api/tidal/queue/42", "DELETE");
  await user.click(
    within(wishlistPanel).getByRole("button", {
      name: "Download On Circles now",
    }),
  );
  await waitFor(() => {
    expect(mockApi).toHaveBeenCalledWith("/api/tidal/queue/42", "PUT", {
      status: "queued",
    });
  });

  await user.click(screen.getByRole("tab", { name: "History" }));
  const historyPanel = screen.getByRole("region", {
    name: "Download history",
  });
  expect(
    within(historyPanel).getByRole("article", { name: "Old Moon" }),
  ).toBeVisible();
  expect(
    within(historyPanel).getByRole("article", { name: "Quiet Sky" }),
  ).toBeVisible();
});

it("uses single-selection tabs for provider results", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );

  const providers = screen.getByRole("tablist", {
    name: "Search result provider",
  });
  await user.click(within(providers).getByRole("tab", { name: "Soulseek" }));
  expect(screen.getByRole("tabpanel", { name: "Soulseek" })).toHaveTextContent(
    "Soulseek results",
  );
});
