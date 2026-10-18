import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Discover } from "./Discover";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { toast } from "sonner";
import fixture from "../../../../tests/admin-e2e/fixtures/discovery-1ai.json";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
const mockApi = vi.mocked(api),
  mockWait = vi.mocked(waitForTask);
let data: Record<string, unknown>;
function Location() {
  const l = useLocation();
  return (
    <output aria-label="Current route">
      {l.pathname}
      {l.search}
    </output>
  );
}
function mount() {
  return render(
    <MemoryRouter initialEntries={["/discover"]}>
      <Discover />
      <Location />
    </MemoryRouter>,
  );
}
async function ready() {
  const view = mount();
  await screen.findByRole("heading", { name: "Discovery" });
  return view;
}
beforeEach(() => {
  vi.clearAllMocks();
  data = structuredClone(fixture);
  mockApi.mockImplementation((path, method) =>
    Promise.resolve(
      method === "POST"
        ? { task_id: "discovery-task" }
        : structuredClone(data[path]),
    ),
  );
  mockWait.mockReturnValue(new Promise(() => {}));
});
afterEach(cleanup);

describe("Discovery text presentation with real hooks", () => {
  it("keeps readings, asset URLs and only reviewed search glyphs at rest", async () => {
    await ready();
    expect(screen.getByRole("heading", { name: "Discovery" })).toHaveClass(
      "font-display",
    );
    const search = screen.getByRole("textbox", { name: "Search discovery" });
    expect(search).toHaveAttribute(
      "placeholder",
      "Search artists, releases or missing albums...",
    );
    expect(search.closest(".crate-form-field")).not.toBeNull();
    expect(document.querySelectorAll("svg:not([data-admin-ux])")).toHaveLength(
      0,
    );
    expect(
      document.querySelectorAll('[data-admin-ux="discovery-search"]'),
    ).toHaveLength(1);
    expect(screen.getByText("40% discography coverage")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
    expect(screen.getByText("2/5 releases")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Biblioteca completa" }),
    ).not.toBeInTheDocument();
    const image = screen.getByRole("img", { name: "Costa Norte" });
    expect(image).toHaveAttribute("src", "/api/artists/23/photo");
    fireEvent.error(image);
    expect(image).toHaveStyle({ display: "none" });
    expect(
      document.querySelector('img[src="/sample-discovery-cover.svg"]'),
    ).toHaveAttribute("alt", "");
    for (const name of [
      "Refresh",
      "Recompute gaps",
      "Check releases",
      "Open artist",
      "Acquire missing",
      "Open full radar",
    ])
      for (const button of screen.getAllByRole("button", { name }))
        expect(button).toHaveClass("min-h-11");
    expect(mockApi.mock.calls.map(([path]) => path).sort()).toEqual([
      "/api/acquisition/new-releases?status=detected",
      "/api/discover/completeness",
      "/api/insights",
    ]);
  });

  it("filters by missing title without refetching and keeps genre/global summary semantics", async () => {
    await ready();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search discovery" }),
      "  MAR DE  ",
    );
    expect(screen.getAllByRole("link", { name: "Costa Norte" })).toHaveLength(
      1,
    );
    expect(
      screen.queryByRole("link", { name: "Viento Sur" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("No detected releases available right now."),
    ).toBeInTheDocument();
    expect(screen.getByText("ambient", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("2 detected releases")).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledTimes(3);
  });

  it("keeps canonical album/artist links and keyboard navigation to acquisition and full radar", async () => {
    await ready();
    expect(
      screen.getByRole("link", { name: "Luz de octubre" }),
    ).toHaveAttribute("href", "/artists/costa-norte/luz-de-octubre");
    for (const link of screen.getAllByRole("link", { name: "Costa Norte" }))
      expect(link).toHaveAttribute("href", "/artists/costa-norte");
    const first = screen.getAllByRole("button", { name: "Open artist" })[0]!;
    first.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/artists/costa-norte",
    );
    screen.getAllByRole("button", { name: "Acquire missing" })[0]!.focus();
    await userEvent.keyboard(" ");
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/download?q=Costa%20Norte",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Open full radar" }),
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/new-releases",
    );
  });

  it("refreshes exactly the three original surfaces from the keyboard", async () => {
    await ready();
    screen.getByRole("button", { name: "Refresh" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(6));
    expect(
      mockApi.mock.calls.filter(
        ([path]) => path === "/api/discover/completeness",
      ),
    ).toHaveLength(2);
  });

  it.each([
    ["completed", {}, "success", "Completeness refresh completed", true],
    [
      "completed",
      { partial: true, failed_artists: 2 },
      "warning",
      "Completeness refreshed with 2 artists skipped",
      true,
    ],
    [
      "completed",
      { finalization_skipped: true },
      "error",
      "Completeness refresh finished with failed chunks",
      false,
    ],
    [
      "completed",
      { cache_written: false },
      "error",
      "Completeness refresh finished with failed chunks",
      false,
    ],
    ["failed", {}, "error", "Sample task failed", false],
  ] as const)(
    "keeps task outcome %s/%j and the exact task wait contract",
    async (status, result, tone, message, refetch) => {
      let finish!: (value: Awaited<ReturnType<typeof waitForTask>>) => void;
      mockWait.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      await ready();
      const button = screen.getByRole("button", { name: "Recompute gaps" });
      button.focus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() =>
        expect(mockWait).toHaveBeenCalledWith(
          "discovery-task",
          1800000,
          expect.any(AbortSignal),
        ),
      );
      expect(mockApi).toHaveBeenCalledWith(
        "/api/discover/completeness/refresh",
        "POST",
      );
      const busy = screen.getByRole("button", { name: "Recomputing..." });
      expect(busy).toBeDisabled();
      expect(busy).toHaveAttribute("aria-busy", "true");
      expect(busy.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(
        screen.getByRole("button", { name: "Check releases" }),
      ).toBeEnabled();
      await act(async () =>
        finish({
          status,
          result,
          error: status === "failed" ? "Sample task failed" : undefined,
        }),
      );
      await waitFor(() => expect(toast[tone]).toHaveBeenCalledWith(message));
      expect(
        screen.getByRole("button", { name: "Recompute gaps" }),
      ).toBeEnabled();
      expect(
        mockApi.mock.calls.filter(
          ([path, method]) =>
            path === "/api/discover/completeness" && method !== "POST",
        ),
      ).toHaveLength(refetch ? 2 : 1);
    },
  );

  it.each([
    [
      "Recompute gaps",
      "/api/discover/completeness/refresh",
      "Failed to queue completeness refresh",
    ],
    [
      "Check releases",
      "/api/acquisition/new-releases/check",
      "Failed to queue release check",
    ],
  ])("keeps %s submission failure and unlocks", async (name, path, message) => {
    await ready();
    mockApi.mockRejectedValue(new Error("Submission failed"));
    await userEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(mockApi).toHaveBeenCalledWith(path, "POST");
    expect(mockWait).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name })).toBeEnabled();
  });

  it("keeps release-check submission locking independent of recomputation", async () => {
    await ready();
    let finish!: (value: unknown) => void;
    mockApi.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const button = screen.getByRole("button", { name: "Check releases" });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Recompute gaps" }),
    ).toBeEnabled();
    await userEvent.click(button);
    expect(
      mockApi.mock.calls.filter(([, method]) => method === "POST"),
    ).toHaveLength(1);
    await act(async () => finish({ task_id: "check-task" }));
    expect(toast.success).toHaveBeenCalledWith("New release check queued");
    expect(button).toBeEnabled();
  });

  it("keeps eight-row limits without reducing the underlying summary", async () => {
    const values = structuredClone(fixture);
    const artist = values["/api/discover/completeness"][0]!;
    values["/api/discover/completeness"] = Array.from(
      { length: 10 },
      (_, i) => ({
        ...artist,
        artist: `Opportunity ${i}`,
        listeners: 1000 - i,
        artist_id: 100 + i,
        artist_slug: `opportunity-${i}`,
      }),
    );
    const release =
      values["/api/acquisition/new-releases?status=detected"].releases[0]!;
    values["/api/acquisition/new-releases?status=detected"].releases =
      Array.from({ length: 10 }, (_, i) => ({
        ...release,
        id: 100 + i,
        album_title: `Release ${i}`,
      }));
    values["/api/insights"].popularity = Array.from({ length: 10 }, (_, i) => ({
      artist: `Trend ${i}`,
      popularity: 50,
      listeners: 20,
    }));
    values["/api/insights"].top_genres = Array.from({ length: 10 }, (_, i) => ({
      genre: `Genre ${i}`,
      artists: 2,
      albums: 3,
    }));
    values["/api/insights"].top_albums = Array.from({ length: 10 }, (_, i) => ({
      album: `Momentum ${i}`,
      artist: "Costa Norte",
      listeners: 20,
      popularity: 50,
      year: "2026",
    }));
    data = values;
    await ready();
    for (const label of [
      "Opportunity 7",
      "Release 7",
      "Trend 7",
      "Genre 7",
      "Costa Norte · Momentum 7",
    ])
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    for (const label of [
      "Opportunity 8",
      "Release 8",
      "Trend 8",
      "Genre 8",
      "Costa Norte · Momentum 8",
    ])
      expect(
        screen.queryByText(label, { exact: true }),
      ).not.toBeInTheDocument();
    expect(screen.getByText("10 acquisition targets")).toBeInTheDocument();
  });

  it("aborts the actual task wait when the page unmounts", async () => {
    const view = await ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Recompute gaps" }),
    );
    await waitFor(() => expect(mockWait).toHaveBeenCalled());
    const signal = mockWait.mock.calls[0]![2]!;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("keeps initial loading bounded and retries the original hard-error surfaces", async () => {
    mockApi.mockReturnValue(new Promise(() => {}));
    const view = mount();
    expect(
      document.querySelector('[data-admin-ux="discovery-loading"]'),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.queryByRole("heading", { name: "Discovery" }),
    ).not.toBeInTheDocument();
    view.unmount();
    mockApi.mockRejectedValue(new Error("Unavailable"));
    mount();
    await screen.findByText("Failed to build discovery workspace");
    mockApi.mockImplementation((path) =>
      Promise.resolve(structuredClone(data[path])),
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: "Discovery" });
  });
});
