import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { useApiMock, apiMock, refetchMock, waitForTaskMock } = vi.hoisted(
  () => ({
    waitForTaskMock: vi.fn(),
    useApiMock: vi.fn(),
    apiMock: vi.fn(),
    refetchMock: vi.fn(),
  }),
);
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/tasks", () => ({ waitForTask: waitForTaskMock }));
vi.mock("@nivo/scatterplot", () => ({
  ResponsiveScatterPlot: () => <div data-testid="comparison-geometry" />,
}));
vi.mock("@nivo/line", () => ({
  ResponsiveLine: () => <div data-testid="timeline-geometry" />,
}));
vi.mock("@crate/ui/lib/read-css-color", () => ({
  readCssColorToken: () => "#123456",
}));
import { Insights } from "./Insights";

const album = {
  id: 7,
  entity_uid: "album-seven",
  slug: "dust",
  title: "Dust",
  artist: "Caspian",
  artist_slug: "caspian",
  year: "2025",
  has_cover: true,
  tracks: 8,
  played_tracks: 2,
  minutes: 30,
  last_day: "2026-06-01",
};
const row = {
  key: "post-rock",
  label: "Post-rock",
  genre_slug: "post-rock",
  tracks: 40,
  albums: 5,
  played_tracks: 2,
  plays: 6,
  minutes: 60,
  catalogue_share: 40,
  listening_share: 60,
  previous_listening_share: 30,
  examples: [album],
};
const fixture = () => ({
  ready: true,
  window: "30d",
  period: {
    start: "2026-09-25",
    end: "2026-10-24",
    previous_start: "2026-08-26",
    previous_end: "2026-09-24",
    history_start: "2026-04-06",
    calendar: "listener_local_days",
    previous_complete: true,
    history_complete: true,
  },
  catalogue: { tracks: 100, albums: 10 },
  current: {
    plays: 10,
    minutes: 120,
    tracks: 6,
    albums: 3,
    concentration_pct: 75,
  },
  previous: {
    plays: 5,
    minutes: 60,
    tracks: 3,
    albums: 2,
    concentration_pct: 60,
  },
  excluded: { plays: 2, minutes: 20 },
  timeline: [
    { day: "2026-09-25", minutes: 20, previous_minutes: 5 },
    { day: "2026-09-26", minutes: 100, previous_minutes: 55 },
  ],
  genres: [
    row,
    {
      ...row,
      key: "unknown",
      label: "Unknown genre",
      genre_slug: null,
      examples: [],
    },
  ],
  decades: [{ ...row, key: "2020s", label: "2020s", genre_slug: null }],
  rising: [
    {
      id: 2,
      entity_uid: "artist-two",
      slug: "caspian",
      name: "Caspian",
      has_photo: true,
      current_minutes: 60,
      previous_minutes: 0,
      delta_minutes: 60,
    },
  ],
  falling: [],
  unheard: {
    total: 2,
    items: [
      {
        ...album,
        id: 8,
        title: "Untouched",
        slug: "untouched",
        played_tracks: 0,
        minutes: 0,
        last_day: null,
      },
    ],
  },
  rediscover: { total: 1, items: [album] },
  improvements: [
    { key: "full", tracks: 2, minutes: 30, albums: [album] },
    { key: "bliss", tracks: 1, minutes: 20, albums: [album] },
  ],
  snapshot: { built_at: "2026-10-24T12:00:00Z", stale: false, missing: false },
});
let report: ReturnType<typeof fixture> | null;
let loading: boolean;
let error: string | null;
let capabilities: unknown;
function setup() {
  return renderWithAdminProviders(<Insights />);
}
beforeEach(() => {
  report = fixture();
  loading = false;
  error = null;
  capabilities = { smart_mix: { available: true } };
  waitForTaskMock.mockReset().mockResolvedValue({ status: "completed" });
  apiMock.mockReset().mockResolvedValue(fixture());
  refetchMock.mockReset();
  useApiMock
    .mockReset()
    .mockImplementation((url: string) =>
      url === "/api/capabilities"
        ? { data: capabilities, loading: false, error: null, refetch: vi.fn() }
        : { data: report, loading, error, refetch: refetchMock },
    );
});
describe("Collection Insights", () => {
  it("shows a recoverable loading state with no invented zero readings", () => {
    report = null;
    loading = true;
    setup();
    expect(
      screen.getByRole("status", { name: "Loading collection insights" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Collection listening summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh insights" }),
    ).toBeEnabled();
  });
  it("shows cold pending separately and refreshes explicitly without polling", async () => {
    report = {
      ...fixture(),
      ready: false,
      period: null,
      current: null,
      previous: null,
      snapshot: { missing: true },
    } as unknown as ReturnType<typeof fixture>;
    setup();
    expect(screen.getByText("Insights are being prepared")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh insights" }),
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/collection-insights?window=30d&fresh=true",
    );
  });
  it("shows scope, denominators, metadata and real entity links", () => {
    setup();
    expect(useApiMock).toHaveBeenCalledWith(
      "/api/admin/collection-insights?window=30d",
    );
    expect(screen.getByText(/Listener-local reported days/)).toBeVisible();
    expect(screen.getByText(/6 \/ 100 indexed tracks/)).toBeVisible();
    expect(screen.getByText(/3 \/ 10 indexed albums/)).toBeVisible();
    expect(screen.getByText(/2 excluded plays/)).toBeVisible();
    const reading = screen.getByRole("group", {
      name: "Selected collection category",
    });
    expect(within(reading).getByText("Post-rock")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Dust/ })[0]).toHaveAttribute(
      "href",
      "/artists/caspian/dust",
    );
    expect(
      screen.getByRole("link", { name: "Explore Post-rock" }),
    ).toHaveAttribute("href", "/genres?genre=post-rock");
    expect(
      screen.getByRole("link", { name: "Open Discovery" }),
    ).toHaveAttribute("href", "/discover");
    expect(screen.getAllByText(/Caspian · 2025/).length).toBeGreaterThan(0);
    expect(screen.getByText(/No activity in previous period/)).toBeVisible();
  });
  it("supports persistent keyboard and tap category readings including unknown metadata", async () => {
    setup();
    const unknown = screen.getByRole("button", {
      name: /Inspect Unknown genre/,
    });
    fireEvent.focus(unknown);
    expect(
      within(
        screen.getByRole("group", { name: "Selected collection category" }),
      ).getByText("Unknown genre"),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: /Inspect Post-rock/ }),
    );
    expect(
      screen.getByRole("button", { name: /Inspect Post-rock/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Decades" }));
    expect(screen.getByRole("button", { name: /Inspect 2020s/ })).toBeVisible();
  });
  it("reads the timeline using arrow keys without a redundant day selector", async () => {
    setup();
    const timeline = screen.getByRole("slider", {
      name: "Inspect listening day",
    });
    timeline.focus();
    await userEvent.keyboard("{Home}");
    expect(timeline).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("2026-09-25"),
    );
    await userEvent.keyboard("{ArrowRight}");
    const reading = screen.getByRole("group", {
      name: "Selected listening day",
    });
    expect(within(reading).getByText("2026-09-26")).toBeVisible();
    expect(within(reading).getByText("100 min")).toBeVisible();
    expect(within(reading).getByText("55 min")).toBeVisible();
    expect(
      screen.queryByRole("combobox", { name: "Inspect day" }),
    ).not.toBeInTheDocument();
  });
  it("retains successful readings on refresh failure and stale data", () => {
    report!.snapshot.stale = true;
    error = "Snapshot failed";
    setup();
    expect(
      screen.getByText(/Showing the last successful snapshot/),
    ).toBeVisible();
    expect(screen.getByText(/Snapshot is stale/)).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Selected collection category" }),
    ).toBeVisible();
  });
  it("never presents a retained previous-window payload as the newly selected period", async () => {
    setup();
    await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
    await userEvent.click(screen.getByRole("option", { name: "90 days" }));
    expect(useApiMock).toHaveBeenCalledWith(
      "/api/admin/collection-insights?window=90d",
    );
    expect(
      screen.queryByRole("region", { name: "Collection listening summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading collection insights" }),
    ).toBeVisible();
  });
  it("keeps zero listening honest and suppresses incomplete prior comparisons", () => {
    report!.period.previous_complete = false;
    report!.current = {
      plays: 0,
      minutes: 0,
      tracks: 0,
      albums: 0,
      concentration_pct: null,
    } as unknown as NonNullable<typeof report>["current"];
    setup();
    expect(screen.getByText(/Previous period is incomplete/)).toBeVisible();
    expect(
      screen.getByText(/No registered listening in this period/),
    ).toBeVisible();
    expect(screen.queryByText(/100% vs previous/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Top 10 concentration" }),
    ).toHaveTextContent("Unavailable");
    expect(
      screen.queryByText(/No activity in previous period/),
    ).not.toBeInTheDocument();
  });
  it.each([undefined, { smart_mix: { available: false } }])(
    "hides Full opportunities when disabled or unknown: %j",
    (value) => {
      capabilities = value;
      setup();
      expect(
        screen.queryByRole("heading", {
          name: "Current Full profiles missing",
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Stored Bliss vectors missing" }),
      ).toBeVisible();
    },
  );
  it("shows Full opportunities only when enabled and never starts repairs", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Current Full profiles missing" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "Open Analysis" })[0],
    ).toHaveAttribute("href", "/analysis");
    expect(
      screen.queryByRole("button", { name: /repair|analyze/i }),
    ).not.toBeInTheDocument();
  });
  it("shows an initial error with explicit refresh recovery", () => {
    report = null;
    error = "unavailable";
    setup();
    expect(
      screen.getByText("Collection insights could not be loaded."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Refresh insights" }),
    ).toBeEnabled();
  });
});

describe("Insights snapshot task completion", () => {
  it("follows an initial cold task once then reads the completed snapshot", async () => {
    report = {
      ...fixture(),
      ready: false,
      period: null,
      current: null,
      previous: null,
      snapshot: { missing: true, pending: true, task_id: "cold-job" },
    } as unknown as ReturnType<typeof fixture>;
    setup();
    expect(
      await screen.findByRole("region", {
        name: "Collection listening summary",
      }),
    ).toBeVisible();
    expect(waitForTaskMock).toHaveBeenCalledWith(
      "cold-job",
      120000,
      expect.any(AbortSignal),
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/collection-insights?window=30d",
    );
  });
  it("follows manual refresh completion without repeatedly polling Insights", async () => {
    apiMock
      .mockResolvedValueOnce({
        ...fixture(),
        snapshot: { ...fixture().snapshot, task_id: "refresh-job" },
      })
      .mockResolvedValueOnce({
        ...fixture(),
        current: { ...fixture().current, tracks: 8 },
        snapshot: { built_at: "2026-10-24T13:00:00Z" },
      });
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh insights" }),
    );
    expect(await screen.findByText(/8 \/ 100 indexed tracks/)).toBeVisible();
    expect(waitForTaskMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/admin/collection-insights?window=30d",
    );
  });
  it("retains the current report when a queued refresh fails", async () => {
    apiMock.mockResolvedValueOnce({
      ...fixture(),
      snapshot: { ...fixture().snapshot, task_id: "failed-job" },
    });
    waitForTaskMock.mockResolvedValueOnce({
      status: "failed",
      error: "Builder unavailable",
    });
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh insights" }),
    );
    expect(
      await screen.findByText(/Showing the last successful snapshot/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Refresh insights" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("group", { name: "Selected collection category" }),
    ).toBeVisible();
  });
  it("aborts only the local task wait when changing period", async () => {
    report = {
      ...fixture(),
      snapshot: { ...fixture().snapshot, task_id: "pending-job" },
    } as unknown as ReturnType<typeof fixture>;
    waitForTaskMock.mockImplementation(() => new Promise(() => {}));
    setup();
    const signal = waitForTaskMock.mock.calls[0]![2] as AbortSignal;
    await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
    await userEvent.click(screen.getByRole("option", { name: "90 days" }));
    expect(signal.aborted).toBe(true);
    expect(apiMock).not.toHaveBeenCalled();
  });
});

it("recovers from an initial load error after a successful manual refresh", async () => {
  report = null;
  error = "Network failed";
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh insights" }),
  );
  expect(
    await screen.findByRole("region", { name: "Collection listening summary" }),
  ).toBeVisible();
  expect(
    screen.queryByText(/could not refresh|could not be loaded/),
  ).not.toBeInTheDocument();
});
it("preserves the selected category when the same window finishes refreshing", async () => {
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: /Inspect Unknown genre/ }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh insights" }),
  );
  expect(
    screen.getByRole("button", { name: /Inspect Unknown genre/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(
      screen.getByRole("group", { name: "Selected collection category" }),
    ).getByText("Unknown genre"),
  ).toBeVisible();
});
it("keeps the last report and enables retry after the bounded task wait times out", async () => {
  apiMock.mockResolvedValueOnce({
    ...fixture(),
    snapshot: { ...fixture().snapshot, task_id: "slow-job" },
  });
  waitForTaskMock.mockRejectedValueOnce(
    new Error("Timed out waiting for task completion"),
  );
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh insights" }),
  );
  expect(
    await screen.findByText(/Showing the last successful snapshot/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Refresh insights" }),
  ).toBeEnabled();
  expect(apiMock).toHaveBeenCalledTimes(1);
});

it("withholds exploration claims and counts while instance history is being reconciled", () => {
  report!.period.history_complete = false;
  report!.unheard = {
    total: 137,
    items: [{ ...album, title: "Withheld unheard album", last_day: null }],
  };
  report!.rediscover = {
    total: 821,
    items: [{ ...album, title: "Withheld rediscover album" }],
  };
  setup();
  expect(
    screen.getByText(
      "Listening history is still being reconciled; exploration lists are unavailable.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Explore the unheard" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Rediscover" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("137 albums")).not.toBeInTheDocument();
  expect(screen.queryByText("821 albums")).not.toBeInTheDocument();
  expect(screen.queryByText("Withheld unheard album")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Withheld rediscover album"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Improvements with listening impact" }),
  ).toBeVisible();
});
it("allows exploration when complete available history is shorter than the prior comparison window", () => {
  report!.period.previous_complete = false;
  setup();
  expect(
    screen.getByRole("heading", { name: "Explore the unheard" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "Rediscover" })).toBeVisible();
  expect(screen.getByRole("link", { name: /Untouched/ })).toBeVisible();
});

it("shows a retryable error for a cold HTTP-200 refresh failure instead of preparing", () => {
  report = {
    ...fixture(),
    ready: false,
    period: null,
    current: null,
    previous: null,
    snapshot: { missing: true, pending: false, refresh_error: true },
  } as unknown as ReturnType<typeof fixture>;
  setup();
  expect(
    screen.getByText("Collection insights could not be loaded."),
  ).toBeVisible();
  expect(
    screen.queryByText("Insights are being prepared"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Refresh insights" }),
  ).toBeEnabled();
});
it("reports the latest HTTP-200 refresh failure even when its payload is older than the retained data", async () => {
  apiMock.mockResolvedValueOnce({
    ...fixture(),
    current: { ...fixture().current, tracks: 1 },
    snapshot: {
      built_at: "2026-10-24T11:00:00Z",
      stale: true,
      refresh_error: true,
    },
  });
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh insights" }),
  );
  expect(
    await screen.findByText(/Showing the last successful snapshot/),
  ).toBeVisible();
  expect(screen.getByText(/6 \/ 100 indexed tracks/)).toBeVisible();
  expect(screen.queryByText(/1 \/ 100 indexed tracks/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Refresh insights" }),
  ).toBeEnabled();
});
it("shows initial stale HTTP-200 failure and clears it on successful refresh", async () => {
  report = {
    ...fixture(),
    snapshot: { ...fixture().snapshot, stale: true, refresh_error: true },
  } as unknown as ReturnType<typeof fixture>;
  setup();
  expect(
    screen.getByText(/Showing the last successful snapshot/),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh insights" }),
  );
  expect(
    screen.queryByText(/could not refresh|could not be loaded/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Collection listening summary" }),
  ).toBeVisible();
});
it("uses the canonical Admin title recipe, accent section captions and human snapshot date", () => {
  const { container } = setup();
  expect(
    screen.getByRole("heading", { name: "Insights", level: 1 }).className,
  ).toContain("text-[clamp(2.25rem,4vw,3.75rem)]");
  for (const heading of screen
    .getAllByRole("heading")
    .filter((item) => item.closest('[data-slot="instrument-panel-header"]'))) {
    expect(heading).toHaveClass("text-accent-action-hi");
  }
  const time = container.querySelector('time[datetime="2026-10-24T12:00:00Z"]');
  expect(time).toHaveTextContent(
    new Date("2026-10-24T12:00:00Z").toLocaleString(),
  );
  expect(
    screen.queryByText(/Snapshot built 2026-10-24T/),
  ).not.toBeInTheDocument();
});

it("follows the newly arrived task when revisiting a period after a manual response", async () => {
  apiMock.mockResolvedValueOnce({
    ...fixture(),
    snapshot: { built_at: "2026-10-24T13:00:00Z" },
  });
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh insights" }),
  );
  report = { ...fixture(), window: "90d" };
  await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
  await userEvent.click(screen.getByRole("option", { name: "90 days" }));
  report = {
    ...fixture(),
    snapshot: { ...fixture().snapshot, task_id: "new-30d-task" },
  } as unknown as ReturnType<typeof fixture>;
  waitForTaskMock.mockImplementation(() => new Promise(() => {}));
  await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
  await userEvent.click(screen.getByRole("option", { name: "30 days" }));
  expect(waitForTaskMock).toHaveBeenCalledWith(
    "new-30d-task",
    120000,
    expect.any(AbortSignal),
  );
  expect(
    screen.getByRole("button", { name: "Refreshing insights" }),
  ).toBeDisabled();
});
it("accepts newly arrived recovery status when revisiting a period after a failed manual response", async () => {
  apiMock.mockResolvedValueOnce({
    ...fixture(),
    snapshot: { built_at: "2026-10-24T13:00:00Z", refresh_error: true },
  });
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh insights" }),
  );
  expect(
    screen.getByText(/Showing the last successful snapshot/),
  ).toBeVisible();
  report = { ...fixture(), window: "90d" };
  await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
  await userEvent.click(screen.getByRole("option", { name: "90 days" }));
  report = fixture();
  await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
  await userEvent.click(screen.getByRole("option", { name: "30 days" }));
  expect(
    screen.queryByText(/could not refresh|could not be loaded/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Refresh insights" }),
  ).toBeEnabled();
});
