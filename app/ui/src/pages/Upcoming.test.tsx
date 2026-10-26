import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { toast } from "sonner";
import { Upcoming } from "./Upcoming";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function show(id: number, artist: string, date: string, venue: string) {
  return {
    id: String(id),
    show_id: id,
    date,
    artist_name: artist,
    artist_id: id,
    artist_slug: artist.trim().toLowerCase().replace(/\s+/g, "-"),
    image_url: null,
    status: "onsale",
    url: `https://tickets.example/shows/${id}`,
    venue,
    city: "Madrid",
    country: "Spain",
    lineup: [artist],
    lineup_artists: [
      {
        name: artist,
        id,
        slug: artist.trim().toLowerCase().replace(/\s+/g, "-"),
        probable_setlist_status:
          artist.trim().toLowerCase() === "other act" ? "missing" : "fresh",
        probable_setlist_generated_at:
          artist.trim().toLowerCase() === "other act"
            ? null
            : "2099-05-14T12:00:00Z",
        probable_setlist_song_count:
          artist.trim().toLowerCase() === "other act" ? 0 : 10,
        probable_setlist_source_show_count:
          artist.trim().toLowerCase() === "other act" ? null : 4,
      },
    ],
  };
}

const ITEMS = [
  show(7, "Band", "2099-05-15", "Sala Norte"),
  show(8, " band ", "2099-05-15", "Sala Norte "),
  show(9, "Band", "2099-05-16", "Sala Sur"),
  show(10, "Other Act", "2099-05-15", "Sala Norte"),
];

const ROWS = [8, 7].map((id) => ({
  id,
  revision: 1,
  artist_name: "Band",
  date: "2099-05-15",
  venue: "Sala Norte",
  city: "Madrid",
  attendance_count: 0,
  reminder_count: 0,
}));

const scrollIntoView = vi.fn();
function cached(events = ITEMS) {
  return {
    events,
    setlist_coverage: {
      artist_count: 2,
      fresh: 1,
      stale: 0,
      missing: 1,
      unknown: 0,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(waitForTask).mockReset().mockResolvedValue({ status: "completed" });
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  vi.mocked(api).mockImplementation(async (url: string, method?: string) => {
    if (url.startsWith("/api/shows/cached?")) return cached();
    if (url === "/api/shows/probable-setlists/refresh" && method === "POST")
      return {
        artist_count: 2,
        fresh: 1,
        stale: 0,
        missing: 1,
        unknown: 0,
        queued: 1,
      };
    if (url.startsWith("/api/show-imports/shows?")) return { items: ROWS };
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => {
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Location">{location.search}</output>;
}

function card(showId: number) {
  const element = document.getElementById(`upcoming-show-${showId}`);
  if (!element) throw new Error(`Show ${showId} is not listed`);
  return element;
}

it("opens a linked show's detail, scrolls to it and drops the link", async () => {
  renderWithAdminProviders(
    <>
      <Upcoming />
      <LocationProbe />
    </>,
    { route: "/upcoming?show_id=9" },
  );
  const detail = await waitFor(() =>
    within(card(9)).getByRole("button", { name: "Close show details" }),
  );
  expect(detail).toBeVisible();
  expect(
    within(card(7)).queryByRole("button", { name: "Close show details" }),
  ).toBeNull();
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
  expect(scrollIntoView.mock.contexts[0]).toBe(card(9));
  // The router applies the replace as a transition.
  await waitFor(() =>
    expect(screen.getByLabelText("Location").textContent).toBe(""),
  );
  expect(
    screen.queryByText("That show isn't in the upcoming list."),
  ).toBeNull();
});

it("matches Listen's collapsed show row pattern and replaces it with the ticket detail", async () => {
  renderWithAdminProviders(<Upcoming />, { route: "/upcoming" });
  expect(screen.getByRole("heading", { name: "Show Management" })).toHaveClass(
    "crate-page-title",
  );
  const headerActions = screen.getByRole("group", {
    name: "Show management actions",
  });
  for (const name of ["List view", "Calendar view", "Sync shows"]) {
    const action = within(headerActions).getByRole("button", { name });
    expect(action).toHaveAttribute("data-size", "icon-lg");
    expect(action).toHaveAttribute("data-variant", "ghost");
    expect(action).not.toHaveAttribute("title");
  }
  await screen.findAllByRole("button", { name: /Band|Other Act/ });
  const row = document.querySelector('[data-slot="upcoming-event-row"]');
  expect(row).toHaveClass("rounded-panel", "border-border-quiet");
  expect(row?.querySelector('[data-slot="upcoming-date"]')).toBeInTheDocument();
  expect(
    row
      ?.querySelector('[data-slot="action-group"]')
      ?.getAttribute("aria-label"),
  ).toBe("Actions for Band show");
  const showButton = row?.querySelector<HTMLButtonElement>(
    'button[aria-expanded="false"]',
  );
  if (!showButton) throw new Error("The collapsed show row is not interactive");
  const showCard = showButton.closest('[id^="upcoming-show-"]');
  await userEvent.setup().click(showButton);
  await screen.findByRole("heading", { name: "Probable setlists by artist" });
  expect(
    document.querySelector('[data-slot="show-management-ticket"]'),
  ).toBeInTheDocument();
  expect(
    showCard?.querySelector('[data-slot="upcoming-event-row"]'),
  ).toBeNull();
  expect(
    document.querySelector(".admin-show-ticket-perforation"),
  ).toBeInTheDocument();
});

it("uses accessible shared actions for calendar month navigation", async () => {
  renderWithAdminProviders(<Upcoming />, { route: "/upcoming" });
  await screen.findAllByRole("button", { name: /Band|Other Act/ });
  await userEvent.click(screen.getByRole("button", { name: "Calendar view" }));

  for (const label of ["Previous month", "Next month"]) {
    const action = screen.getByRole("button", { name: label });
    expect(action).toHaveAttribute("aria-label", label);
    expect(action).not.toHaveAttribute("title");
  }
});

it("paginates the show list without changing calendar data", async () => {
  const events = Array.from({ length: 23 }, (_, index) =>
    show(
      index + 101,
      `Artist ${index + 1}`,
      `2099-07-${String(index + 1).padStart(2, "0")}`,
      `Venue ${index + 1}`,
    ),
  );
  vi.mocked(api).mockImplementation(async (url: string) => {
    if (url.startsWith("/api/shows/cached?")) return cached(events);
    if (url.startsWith("/api/show-imports/shows?")) return { items: [] };
    throw new Error(`Unexpected request: ${url}`);
  });

  renderWithAdminProviders(<Upcoming />, { route: "/upcoming" });

  expect(await screen.findByText("Artist 20", { exact: true })).toBeVisible();
  expect(screen.queryByText("Artist 21", { exact: true })).toBeNull();
  expect(screen.getByText("1–20 of 23 · page 1 of 2")).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole("button", { name: "Next shows page" }),
  );

  expect(await screen.findByText("Artist 21", { exact: true })).toBeVisible();
  expect(screen.queryByText("Artist 1", { exact: true })).toBeNull();
  expect(screen.getByText("21–23 of 23 · page 2 of 2")).toBeInTheDocument();
});

it("opens a linked show on the page that contains it", async () => {
  const events = Array.from({ length: 23 }, (_, index) =>
    show(
      index + 101,
      `Artist ${index + 1}`,
      `2099-07-${String(index + 1).padStart(2, "0")}`,
      `Venue ${index + 1}`,
    ),
  );
  vi.mocked(api).mockImplementation(async (url: string) => {
    if (url.startsWith("/api/shows/cached?")) return cached(events);
    if (url.startsWith("/api/show-imports/shows?")) return { items: [] };
    throw new Error(`Unexpected request: ${url}`);
  });

  renderWithAdminProviders(<Upcoming />, {
    route: "/upcoming?show_id=121",
  });

  const linkedShow = await waitFor(() => card(121));
  expect(linkedShow).toHaveTextContent("Artist 21");
  expect(
    within(linkedShow).getByRole("button", { name: "Close show details" }),
  ).toBeVisible();
  expect(screen.getByText("21–23 of 23 · page 2 of 2")).toBeInTheDocument();
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
  expect(scrollIntoView.mock.contexts[0]).toBe(linkedShow);
});

it("says so when the linked show isn't in the upcoming list", async () => {
  renderWithAdminProviders(
    <>
      <Upcoming />
      <LocationProbe />
    </>,
    { route: "/upcoming?show_id=99" },
  );
  expect(
    await screen.findByText("That show isn't in the upcoming list."),
  ).toHaveAttribute("role", "status");
  // The router applies the replace as a transition.
  await waitFor(() =>
    expect(screen.getByLabelText("Location").textContent).toBe(""),
  );
  expect(screen.queryByRole("button", { name: "Close show details" })).toBe(
    null,
  );
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it("merges from a show's detail with its look-alikes already loaded", async () => {
  renderWithAdminProviders(<Upcoming />, { route: "/upcoming?show_id=8" });
  const detail = await waitFor(() => card(8));
  const user = userEvent.setup();
  await user.click(
    await within(detail).findByRole("button", {
      name: "Merge duplicates of this show",
    }),
  );
  const panel = await screen.findByRole("dialog", {
    name: "Merge duplicate shows",
  });
  // This show first, then the same artist on the same date; not show 9
  // (another date) nor show 10 (another artist).
  expect(within(panel).getByLabelText("Show IDs")).toHaveValue("8, 7");
  expect(
    await within(panel).findByRole("radio", { name: "Keep show 8" }),
  ).toBeChecked();
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(([url]) => url.startsWith("/api/show-imports/shows?"))
      .map(([url]) => url),
  ).toEqual(["/api/show-imports/shows?ids=8&ids=7"]);
  expect(
    vi.mocked(api).mock.calls.filter(([, method]) => method === "POST"),
  ).toHaveLength(0);
  expect(
    within(panel).queryByRole("button", { name: "Merge shows" }),
  ).toBeNull();
});

it("still opens an empty merge editor from the toolbar", async () => {
  renderWithAdminProviders(<Upcoming />);
  await waitFor(() => card(7));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Merge duplicates" }));
  const panel = await screen.findByRole("dialog", {
    name: "Merge duplicate shows",
  });
  expect(within(panel).getByLabelText("Show IDs")).toHaveValue("");
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(([url]) => url.startsWith("/api/show-imports/shows?")),
  ).toHaveLength(0);
});

it("shows setlist freshness for billed artists and queues a refresh without loading setlist data inline", async () => {
  renderWithAdminProviders(<Upcoming />, {
    auth: {
      hasCapability: (capability: string) =>
        ["curation.shows.write", "library.metadata.write"].includes(capability),
      isAdmin: true,
    },
  });
  expect(await screen.findByText("2 billed artists", {})).toBeInTheDocument();
  expect(screen.getByText("1 recent", {})).toBeInTheDocument();
  expect(screen.getByText("1 missing", {})).toBeInTheDocument();

  await userEvent.click(
    screen.getAllByRole("button", { name: /Sala Norte/ })[0]!,
  );
  expect(
    await screen.findByRole("heading", { name: "Probable setlists by artist" }),
  ).toBeInTheDocument();
  expect(screen.getByText("10 songs", {})).toBeInTheDocument();
  expect(screen.getByText("Based on 4 shows", {})).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole("button", { name: "Refresh setlists" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/shows/probable-setlists/refresh",
      "POST",
    ),
  );
  expect(await screen.findByText("1 refreshes queued", {})).toBeInTheDocument();
});

it("opens the manual show editor from the toolbar, for show curators only", async () => {
  const { unmount } = renderWithAdminProviders(<Upcoming />);
  await userEvent.click(screen.getByRole("button", { name: "Add show" }));
  expect(screen.getByRole("dialog", { name: "Add show" })).toBeInTheDocument();
  unmount();
  renderWithAdminProviders(<Upcoming />, {
    auth: { hasCapability: () => false, isAdmin: false },
  });
  expect(
    screen.queryByRole("button", { name: "Add show" }),
  ).not.toBeInTheDocument();
});

it("offers the detail merge only to show curators", async () => {
  renderWithAdminProviders(<Upcoming />, {
    route: "/upcoming?show_id=7",
    auth: {
      hasCapability: (capability: string) =>
        capability !== "curation.shows.write",
    },
  });
  await waitFor(() =>
    within(card(7)).getByRole("button", { name: "Close show details" }),
  );
  expect(screen.queryByRole("button", { name: /Merge duplicates/ })).toBe(null);
});

it("has the not-listed notice's status region in place before the notice", async () => {
  let resolve!: (value: ReturnType<typeof cached>) => void;
  const upcoming = new Promise<ReturnType<typeof cached>>((done) => {
    resolve = done;
  });
  vi.mocked(api).mockImplementation(async (url: string) => {
    if (url.startsWith("/api/shows/cached?")) return upcoming;
    throw new Error(`Unexpected request: ${url}`);
  });
  renderWithAdminProviders(<Upcoming />, { route: "/upcoming?show_id=99" });
  const status = screen.getByRole("status", { name: "Show link status" });
  expect(status).toBeEmptyDOMElement();
  await act(async () => resolve(cached()));
  await waitFor(() =>
    expect(status).toHaveTextContent("That show isn't in the upcoming list."),
  );
  expect(screen.getByRole("status")).toBe(status);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.getByRole("status")).toBe(status);
  expect(status).toBeEmptyDOMElement();
});

describe("exact twin shows", () => {
  // Two saved shows with the very same details, so only their IDs differ.
  const TWINS = [
    show(11, "Fix Wave Band", "2099-07-10", "Sala Sol"),
    show(12, "Fix Wave Band", "2099-07-10", "Sala Sol"),
  ];

  beforeEach(() => {
    vi.mocked(api).mockImplementation(async (url: string) => {
      if (url.startsWith("/api/shows/cached?"))
        return cached([...ITEMS, ...TWINS]);
      if (url.startsWith("/api/show-imports/shows?")) return { items: ROWS };
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  function isOpen(showId: number) {
    return (
      within(card(showId)).queryByRole("button", {
        name: "Close show details",
      }) !== null
    );
  }

  it("expands each one on its own, with no duplicate-key warning", async () => {
    const errors = vi.spyOn(console, "error");
    try {
      renderWithAdminProviders(<Upcoming />);
      await waitFor(() => card(12));
      const user = userEvent.setup();
      await user.click(
        within(card(11)).getByRole("button", { expanded: false }),
      );
      expect(isOpen(11)).toBe(true);
      expect(isOpen(12)).toBe(false);
      await user.click(
        within(card(12)).getByRole("button", { expanded: false }),
      );
      expect(isOpen(12)).toBe(true);
      expect(isOpen(11)).toBe(false);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("opens only the linked one, with a merge button named for that show", async () => {
    renderWithAdminProviders(<Upcoming />, { route: "/upcoming?show_id=12" });
    await waitFor(() => expect(isOpen(12)).toBe(true));
    expect(isOpen(11)).toBe(false);
    await waitFor(() => expect(scrollIntoView.mock.contexts[0]).toBe(card(12)));
    const merge = within(card(12)).getByRole("button", {
      name: "Merge duplicates of this show",
    });
    expect(merge).toHaveTextContent("Merge duplicates");
    expect(
      within(card(11)).queryByRole("button", { name: /Merge duplicates/ }),
    ).toBeNull();
  });
});

it("distinguishes unavailable shows from an empty calendar and retries the read", async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
  renderWithAdminProviders(<Upcoming />, { route: "/upcoming" });
  const error = await screen.findByRole("alert");
  expect(error).toHaveTextContent(/shows/i);
  expect(screen.queryByText("No upcoming shows")).not.toBeInTheDocument();
  expect(
    screen.queryByText("0 shows", { exact: true }),
  ).not.toBeInTheDocument();
  await user.click(within(error).getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("button", { name: /Other Act/ }),
  ).toBeVisible();
});

it.each(["completed", "failed"])(
  "keeps sync pending until the task is %s and reports its outcome",
  async (status) => {
    const user = userEvent.setup();
    let finish!: (task: { status: string; error?: string }) => void;
    const pending = new Promise<{ status: string; error?: string }>(
      (resolve) => {
        finish = resolve;
      },
    );
    vi.mocked(waitForTask).mockReturnValue(pending);
    const implementation = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation((url, method, body, options) =>
      url === "/api/tasks/sync-shows"
        ? Promise.resolve({ task_id: "show-sync" })
        : implementation(url, method, body, options),
    );
    renderWithAdminProviders(<Upcoming />, { route: "/upcoming" });
    await screen.findByRole("button", { name: /Other Act/ });
    const before = vi
      .mocked(api)
      .mock.calls.filter(([url]) =>
        url.startsWith("/api/shows/cached?"),
      ).length;
    const sync = screen.getByRole("button", { name: "Sync shows" });
    await user.click(sync);
    expect(waitForTask).toHaveBeenCalledWith(
      "show-sync",
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(sync).toBeDisabled();
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([url]) => url.startsWith("/api/shows/cached?")),
    ).toHaveLength(before);
    await act(async () => {
      finish({
        status,
        error: status === "failed" ? "Sync worker failed" : undefined,
      });
      await pending;
    });
    expect(sync).toBeEnabled();
    if (status === "completed") {
      expect(
        vi
          .mocked(api)
          .mock.calls.filter(([url]) => url.startsWith("/api/shows/cached?")),
      ).toHaveLength(before + 1);
      expect(toast.success).toHaveBeenCalledWith("Show sync completed");
    } else {
      expect(toast.error).toHaveBeenCalledWith("Sync worker failed");
    }
  },
);
