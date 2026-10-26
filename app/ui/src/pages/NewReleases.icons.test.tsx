import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewReleases } from "./NewReleases";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { toast } from "sonner";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import fixture from "../../../../tests/admin-e2e/fixtures/new-releases-1aj.json";
vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiSseUrl: (path: string) => path,
}));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const mockApi = vi.mocked(api),
  mockWait = vi.mocked(waitForTask);
class SampleStream {
  static instances: SampleStream[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    SampleStream.instances.push(this);
  }
  send(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
type SampleRelease = {
  [
    K in keyof (typeof fixture)["releases"][number]
  ]: (typeof fixture)["releases"][number][K];
};
let data: { releases: SampleRelease[] } = structuredClone(fixture);
function Location() {
  const l = useLocation();
  return (
    <output aria-label="Current route">
      {l.pathname}
      {l.search}
    </output>
  );
}
function mount(capabilities = ["curation.releases.write"]) {
  return renderWithAdminProviders(
    <>
      <NewReleases />
      <Location />
    </>,
    {
      route: "/new-releases",
      auth: {
        hasCapability: (cap) => capabilities.includes(cap),
        hasAnyCapability: (caps) =>
          caps.some((cap) => capabilities.includes(cap)),
      },
    },
  );
}
async function ready(capabilities?: string[]) {
  const v = mount(capabilities);
  await screen.findByText("Luz de octubre", {});
  return v;
}
function statValue(label: string) {
  const field = Array.from(document.querySelectorAll(".crate-form-field")).find(
    (element) => element.children[0]?.textContent?.trim() === label,
  );
  const value = field?.children[1];
  if (!value) throw new Error(`Could not find the ${label} statistic value`);
  return value.textContent?.trim();
}
beforeEach(() => {
  vi.clearAllMocks();
  data = structuredClone(fixture);
  SampleStream.instances = [];
  vi.stubGlobal("EventSource", SampleStream);
  mockApi.mockImplementation(async (path, method) => {
    if (method === "POST") return { task_id: "release-check-task" };
    if (path !== "/api/acquisition/new-releases/snapshot")
      throw new Error(`Unexpected GET ${path}`);
    return structuredClone(data);
  });
  mockWait.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("New Releases text presentation with real data hook and handlers", () => {
  it("keeps names, canonical links and raw artwork, retiring only redundant glyphs", async () => {
    await ready();
    expect(
      Array.from(document.querySelectorAll("svg:not([data-admin-ux])")).filter(
        (el) =>
          !el.closest('[role="combobox"]') &&
          !el.closest('[data-slot="search-input"]') &&
          !el.closest('[data-testid="media-cover-fallback"]'),
      ),
    ).toHaveLength(0);
    expect(
      screen
        .getByRole("searchbox", { name: "Search releases" })
        .closest(".crate-form-field"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("combobox", { name: "All types" })
        .closest(".crate-form-field"),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Release Radar" })).toHaveClass(
      "crate-page-title",
    );
    expect(
      screen.getByRole("link", { name: "Luz de octubre" }),
    ).toHaveAttribute("href", "/artists/costa-norte/luz-de-octubre");
    expect(
      screen.getByRole("link", { name: "Luz de octubre" }).closest("article"),
    ).toHaveTextContent("Costa Norte");
    expect(
      document.querySelector('img[src="/sample-new-release-cover.svg"]'),
    ).toHaveAttribute("alt", "");
    expect(screen.getByText("3 / 8 in library", {})).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="upcoming-date"]'),
    ).not.toBeNull();
    const timelineRow = document.querySelector(
      '[data-slot="release-radar-row"][aria-label="Luz de octubre by Costa Norte"]',
    );
    expect(
      timelineRow?.querySelector('[data-slot="upcoming-event-row"]'),
    ).toBeInTheDocument();
    expect(
      timelineRow?.querySelector('[data-slot="action-group"]'),
    ).toHaveAttribute("aria-label", "Actions for Luz de octubre");
    expect(
      screen.queryByRole("link", { name: "Puerto sin fecha" }),
    ).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button"))
      if (button.closest('[data-slot="admin-page-header"]'))
        expect(button).toHaveAttribute("data-size", "icon-lg");
      else if (button.closest('[data-slot="action-group"]'))
        expect(button).toHaveAttribute("data-size", "icon-lg");
      else if (button.getAttribute("data-slot") === "chip")
        expect(button).toHaveClass("[@media(pointer:coarse)]:min-h-11");
      else expect(button).not.toHaveClass("min-h-11");
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(SampleStream.instances).toHaveLength(1);
    expect(SampleStream.instances[0]!.url).toBe(
      "/api/acquisition/new-releases/stream",
    );
  });
  it("filters without requests and preserves global summary and descending release dates", async () => {
    await ready();
    const search = screen.getByPlaceholderText("Search artist or album...");
    await userEvent.type(search, "  COSTA  ");
    expect(screen.queryByText("Puerto sin fecha", {})).not.toBeInTheDocument();
    expect(statValue("Needs action")).toBe("3");
    expect(
      screen
        .getAllByRole("link", { name: /^(Mañana|Luz de octubre)$/ })
        .map((el) => el.getAttribute("href")),
    ).toEqual(["/artists/costa-norte/luz-de-octubre"]);
    expect(
      screen
        .getByText("Mañana", {})
        .compareDocumentPosition(screen.getByText("Luz de octubre", {})) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await userEvent.clear(search);
    await userEvent.click(screen.getByRole("button", { name: "Downloaded" }));
    expect(screen.getByRole("link", { name: "Horizonte" })).toHaveAttribute(
      "href",
      "/artists/viento-sur/horizonte",
    );
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "Release date" })).getByRole(
        "button",
        { name: "Upcoming" },
      ),
    );
    expect(screen.getByText("Mañana", {})).toBeInTheDocument();
    expect(screen.queryByText("Horizonte", {})).not.toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledTimes(1);
  });
  it("uses the existing dynamic searchable type select and filters unknown types", async () => {
    await ready();
    await userEvent.click(screen.getByRole("combobox", { name: "All types" }));
    await userEvent.click(
      await screen.findByRole("option", { name: /Unknown type/ }),
    );
    expect(screen.getByText("Puerto sin fecha", {})).toBeInTheDocument();
    expect(screen.queryByText("Luz de octubre", {})).not.toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledTimes(1);
  });
  it.each([
    [[], 0, 0],
    [["library.tidal.manage"], 2, 0],
    [["curation.releases.write"], 2, 3],
    [["library.view"], 0, 0],
  ])("preserves action capabilities %j", async (caps, downloads, dismisses) => {
    await ready(caps as string[]);
    expect(screen.queryAllByRole("button", { name: "Download" })).toHaveLength(
      downloads as number,
    );
    expect(
      screen.queryAllByRole("button", { name: "Dismiss release" }),
    ).toHaveLength(dismisses as number);
    expect(screen.queryByRole("button", { name: "Check now" }) !== null).toBe(
      (caps as string[]).includes("curation.releases.write"),
    );
  });
  it("keeps view selection, dismiss glyphs and native keyboard navigation", async () => {
    await ready();
    const grid = screen.getByRole("button", { name: "Grid" });
    grid.focus();
    await userEvent.keyboard("{Enter}");
    expect(grid).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Timeline" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      document.querySelectorAll('[data-admin-ux="releases-grid-dismiss"]'),
    ).toHaveLength(3);
    expect(
      Array.from(document.querySelectorAll("svg:not([data-admin-ux])")).filter(
        (el) =>
          !el.closest('[role="combobox"]') &&
          !el.closest('[data-slot="search-input"]') &&
          !el.closest('[data-testid="media-cover-fallback"]'),
      ),
    ).toHaveLength(0);
    const album = screen.getByRole("link", { name: "Luz de octubre" });
    album.focus();
    await userEvent.keyboard("{Enter}");
    expect(
      screen.getByRole("status", { name: "Current route" }),
    ).toHaveTextContent("/artists/costa-norte/luz-de-octubre");
  });
  it("downloads the selected id and preserves timeline/grid status eligibility", async () => {
    await ready();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Download" })[1]!,
    );
    expect(mockApi).toHaveBeenCalledWith(
      "/api/acquisition/new-releases/101/download",
      "POST",
    );
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Downloading" }));
    expect(
      document.querySelectorAll('[data-admin-ux="releases-download-loading"]'),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Dismiss release" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.getAllByText("Downloading", {}).length).toBeGreaterThan(1);
    expect(
      screen.queryByRole("button", { name: "Download" }),
    ).not.toBeInTheDocument();
  });
  it("dismisses the selected id locally without a refetch", async () => {
    await ready();
    const dismisses = screen.getAllByRole("button", {
      name: "Dismiss release",
    });
    await userEvent.click(dismisses[0]!);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/acquisition/new-releases/105/dismiss",
      "POST",
    );
    expect(screen.queryByText("Mañana", {})).not.toBeInTheDocument();
    expect(statValue("Needs action")).toBe("2");
    expect(mockApi).toHaveBeenCalledTimes(2);
  });
  it.each(["download", "dismiss"])(
    "keeps failed %s actions from changing the surface",
    async (action) => {
      await ready();
      mockApi.mockRejectedValueOnce(new Error("offline"));
      await userEvent.click(
        screen.getAllByRole("button", {
          name: action === "download" ? "Download" : "Dismiss release",
        })[0]!,
      );
      expect(toast.error).toHaveBeenCalledWith(
        action === "download" ? "Download failed" : "Dismiss failed",
      );
      expect(screen.getByText("Mañana", {})).toBeInTheDocument();
      expect(statValue("Needs action")).toBe("3");
    },
  );
  it("keeps the check busy until its exact task completes then reads the snapshot", async () => {
    await ready();
    let finish!: (result: Awaited<ReturnType<typeof waitForTask>>) => void;
    mockWait.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    const busy = screen.getByRole("button", { name: "Checking…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(
      document.querySelector('[data-admin-ux="releases-check-loading"]'),
    ).toHaveAttribute("aria-hidden", "true");
    expect(mockApi).toHaveBeenCalledWith(
      "/api/acquisition/new-releases/check",
      "POST",
    );
    expect(mockWait).toHaveBeenCalledWith("release-check-task", 300000);
    await act(async () => {
      finish({ status: "completed" } as Awaited<
        ReturnType<typeof waitForTask>
      >);
    });
    expect(
      await screen.findByRole("button", { name: "Check now" }),
    ).toBeEnabled();
    expect(
      mockApi.mock.calls.filter(([, method]) => method !== "POST"),
    ).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledWith("Release check complete");
  });
  it.each(["failed", "reject"])(
    "preserves terminal check outcome %s without a successful refresh",
    async (outcome) => {
      await ready();
      if (outcome === "reject")
        mockWait.mockRejectedValueOnce(new Error("offline"));
      else
        mockWait.mockResolvedValueOnce({ status: "failed" } as Awaited<
          ReturnType<typeof waitForTask>
        >);
      await userEvent.click(screen.getByRole("button", { name: "Check now" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Check now" })).toBeEnabled(),
      );
      expect(
        mockApi.mock.calls.filter(([, method]) => method !== "POST"),
      ).toHaveLength(1);
      expect(toast.success).not.toHaveBeenCalledWith("Release check complete");
      expect(toast.error).toHaveBeenCalledTimes(1);
    },
  );
  it("preserves a failed check POST without starting a task", async () => {
    await ready();
    mockApi.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(screen.getByRole("button", { name: "Check now" })).toBeEnabled();
    expect(mockWait).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to queue the release check",
    );
    expect(statValue("Needs action")).toBe("3");
  });
  it("keeps existing unknown-status eligibility differences between timeline and grid", async () => {
    data.releases = [{ ...data.releases[0]!, status: "failed" }];
    mount();
    await screen.findByRole("heading", { name: "Release Radar" });
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(
      screen.getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss release" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(
      screen.queryByRole("button", { name: "Download" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Dismiss release" }),
    ).not.toBeInTheDocument();
  });
  it("preserves SSE replacement, malformed-message tolerance, filters and cleanup", async () => {
    const view = await ready();
    const stream = SampleStream.instances[0]!;
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await userEvent.type(
      screen.getByPlaceholderText("Search artist or album..."),
      "Luz",
    );
    act(() => stream.onmessage?.({ data: "not json" }));
    expect(
      screen.getByRole("link", { name: "Luz de octubre" }),
    ).toBeInTheDocument();
    act(() =>
      stream.send({
        releases: [{ ...data.releases[0]!, album_title: "Luz del sur" }],
      }),
    );
    expect(
      screen.getByRole("link", { name: "Luz del sur" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search artist or album..."),
    ).toHaveValue("Luz");
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(SampleStream.instances).toHaveLength(1);
    view.unmount();
    expect(stream.close).toHaveBeenCalledTimes(1);
  });
  it("retains loading and empty-state words with no decorative glyphs", async () => {
    mockApi.mockReturnValueOnce(new Promise(() => {}));
    const v = mount();
    expect(
      document.querySelector('[data-admin-ux="releases-loading"]'),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("status", { name: "Loading releases" }),
    ).toBeInTheDocument();
    v.unmount();
    data.releases = [];
    mount();
    await screen.findByText("No releases match the current radar", {});
    expect(
      Array.from(document.querySelectorAll("svg:not([data-admin-ux])")).filter(
        (el) =>
          !el.closest('[role="combobox"]') &&
          !el.closest('[data-slot="search-input"]'),
      ),
    ).toHaveLength(0);
  });
  it("uses semantic solid surfaces for timeline, grid, and empty results", async () => {
    await ready();
    const getReleaseArticles = () =>
      Array.from(document.querySelectorAll("article[aria-label]"));
    expect(getReleaseArticles()).toHaveLength(3);
    expect(
      getReleaseArticles().every((article) =>
        article.classList.contains("bg-surface-object"),
      ),
    ).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(getReleaseArticles()).toHaveLength(3);
    expect(
      getReleaseArticles().every(
        (article) =>
          article.classList.contains("bg-raised-surface") &&
          article.classList.contains("shadow-none"),
      ),
    ).toBe(true);

    await userEvent.type(
      screen.getByPlaceholderText("Search artist or album..."),
      "no matching release",
    );
    const emptyTitle = await screen.findByText(
      "No releases match the current radar",
      {},
    );
    const empty = emptyTitle.closest('[role="status"]');
    expect(empty).not.toBeNull();
    expect(empty).toHaveClass("bg-raised-surface", "shadow-none");
  });
  it("retries a hard read error through the original snapshot hook", async () => {
    mockApi.mockRejectedValueOnce(new Error("Read unavailable"));
    mount();
    await screen.findByText("Read unavailable", {});
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Luz de octubre", {});
    expect(mockApi).toHaveBeenCalledTimes(2);
  });
  it("preserves date fallback and invalid-date display", async () => {
    data.releases = [{ ...data.releases[1]!, release_date: "not-a-date" }];
    mount();
    await screen.findByText("not-a-date", {});
    expect(screen.getByText("Puerto sin fecha", {})).toBeInTheDocument();
  });
});
