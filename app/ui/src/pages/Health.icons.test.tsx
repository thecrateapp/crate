import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthContext } from "@/contexts/AuthContext";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../../tests/admin-e2e/fixtures/health-1ad.json";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { useTaskEvents } from "@/hooks/use-task-events";
import { Health } from "./Health";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/hooks/use-task-events", () => ({ useTaskEvents: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const reset = vi.fn();
let sampleHealth = {
  ...structuredClone(fixture.health),
  counts: { ...fixture.health.counts } as Record<string, number>,
  runs: { ...fixture.health.runs } as Record<
    string,
    { last_run_at: string | null; duration_ms: number; issue_count: number }
  >,
};
let missingCatalog = false;
const streams: LocalSource[] = [];
class LocalSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    streams.push(this);
  }
}
function mount(isAdmin = true) {
  return renderWithAdminProviders(<Health />, { auth: { isAdmin } });
}
async function ready() {
  return screen.findByRole("button", {
    name: "Review issues: Unindexed Files",
  });
}
function card(toggle: HTMLElement) {
  return within(toggle.closest("article")! as HTMLElement);
}
beforeEach(() => {
  vi.clearAllMocks();
  sampleHealth = {
    ...structuredClone(fixture.health),
    counts: { ...fixture.health.counts },
    runs: { ...fixture.health.runs },
  };
  missingCatalog = false;
  streams.length = 0;
  vi.stubGlobal("EventSource", LocalSource);
  vi.mocked(useTaskEvents).mockReturnValue({
    events: [],
    done: null,
    connected: false,
    reset,
  });
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (method === "POST")
      return {
        task_id: "sample-health-task",
        task_ids: ["sample-health-task"],
        fixable: 1,
        allowed: true,
      } as never;
    if (path.startsWith("/api/manage/repair-catalog")) {
      if (missingCatalog) throw new Error("catalog unavailable");
      return structuredClone(fixture.catalog) as never;
    }
    if (path.startsWith("/api/admin/tasks-snapshot"))
      return structuredClone(fixture.tasks) as never;
    const check = new URL(path, "http://sample.test").searchParams.get(
      "check_type",
    );
    return {
      ...structuredClone(sampleHealth),
      issues: sampleHealth.issues.filter(
        (i) => !check || i.check_type === check,
      ),
    } as never;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Library Health text controls and preserved UX", () => {
  it("uses one accessible disclosure with sibling actions and no retired glyphs", async () => {
    const user = userEvent.setup(),
      { container } = mount(),
      toggle = await ready();
    expect(container.querySelector("button button,button a")).toBeNull();
    expect(
      container.querySelector(
        "svg:not(.lucide-chevron-down):not(.lucide-chevron-up)",
      ),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "Library Health" })).toHaveClass(
      "font-display",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAccessibleDescription(
      /Unindexed Files 1 issue medium Safe Database.*Checked/,
    );
    const artistToggle = screen.getByRole("button", {
      name: "Review issues: Artist Layout Fix",
    });
    expect(artistToggle).toHaveAccessibleDescription(
      /Artist Layout Fix 1 issue high Needs review DB \+ filesystem.*Checked.*Review artist-by-artist before applying this fix\./,
    );
    toggle.focus();
    await user.keyboard(" ");
    const region = screen.getByRole("region", {
      name: "Unindexed Files issues",
    });
    expect(toggle).toHaveAttribute("aria-controls", region.id);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleDescription(
      /Unindexed Files 1 issue medium Safe Database.*Checked/,
    );
    expect(within(region).getByText("Sample unindexed files")).toBeVisible();
    await user.keyboard(" ");
    expect(
      screen.queryByRole("region", { name: "Unindexed Files issues" }),
    ).not.toBeInTheDocument();
  });
  it.each([
    ["Mark as resolved", "resolve"],
    ["Dismiss: it stays hidden unless its details change", "dismiss"],
  ])("keeps the correct issue endpoint for %s", async (name, action) => {
    const user = userEvent.setup();
    mount();
    await user.click(await ready());
    const region = screen.getByRole("region", {
      name: "Unindexed Files issues",
    });
    const button = within(region).getByRole("button", { name });
    expect(button).toHaveTextContent(
      action === "resolve" ? "Resolve" : "Dismiss",
    );
    await user.click(button);
    expect(api).toHaveBeenCalledWith(
      `/api/manage/health-issues/101/${action}`,
      "POST",
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Sample unindexed files"),
      ).not.toBeInTheDocument(),
    );
  });
  it("keeps global repair action isolated from disclosure", async () => {
    const user = userEvent.setup();
    mount();
    const toggle = await ready();
    await user.click(toggle);
    await user.click(
      card(toggle).getByRole("button", {
        name: "Queue repair for Unindexed Files",
      }),
    );
    expect(api).toHaveBeenCalledWith(
      "/api/manage/health-issues/fix-type/unindexed_files",
      "POST",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", {
        name: "Queue repair for Unindexed Files",
        busy: true,
      }),
    ).toBeDisabled();
  });
  it("preserves bulk confirmation, cancellation focus and artist repair route", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const toggle = screen.getByRole("button", {
      name: "Review issues: Artist Layout Fix",
    });
    await user.click(toggle);
    const fix = card(toggle).getByRole("button", {
      name: "Queue repair for Artist Layout Fix",
    });
    await user.click(fix);
    let dialog = screen.getByRole("alertdialog", {
      name: "Queue artist repairs",
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fix).toHaveFocus();
    expect(api).not.toHaveBeenCalledWith(
      "/api/manage/health-issues/fix-type/artist_layout_fix",
      "POST",
    );
    await user.click(fix);
    dialog = screen.getByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Queue repairs" }),
    );
    expect(api).toHaveBeenCalledWith(
      "/api/manage/health-issues/fix-type/artist_layout_fix",
      "POST",
    );
    expect(
      within(
        screen.getByRole("region", { name: "Artist Layout Fix issues" }),
      ).getByRole("link", { name: "Review and repair" }),
    ).toHaveAttribute("href", expect.stringMatching(/\?repair=1$/));
  });
  it("preserves cleanup and type dismissal paths", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(
      screen.getByRole("button", { name: "Review issues: Duplicate Tracks" }),
    );
    await user.click(screen.getByRole("button", { name: "Run cleanup now" }));
    expect(api).toHaveBeenCalledWith(
      "/api/manage/repair-duplicate-tracks",
      "POST",
    );
    await user.click(
      screen.getByRole("button", { name: "Review issues: Tag Mismatch" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Dismiss all Tag Mismatch issues",
      }),
    );
    expect(api).toHaveBeenCalledWith(
      "/api/manage/health-issues/dismiss-type/tag_mismatch",
      "POST",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Review issues: Tag Mismatch" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("keeps filter requests, scan busy/completion and stream cleanup", async () => {
    const user = userEvent.setup();
    const view = mount();
    await ready();
    await user.click(
      screen.getByText("Filter issues", { selector: "summary" }),
    );
    await user.click(
      screen.getByRole("button", { name: /^Unindexed Files\s*1$/ }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/health-snapshot?check_type=unindexed_files",
        "GET",
        undefined,
        expect.anything(),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Run scan" }));
    expect(api).toHaveBeenCalledWith("/api/manage/health-check", "POST");
    expect(screen.getByRole("button", { name: "Scanning..." })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    vi.mocked(useTaskEvents).mockReturnValue({
      events: [],
      done: { status: "completed" },
      connected: false,
      reset,
    });
    view.rerender(
      <MemoryRouter>
        <AuthContext.Provider value={view.authValue}>
          <Health />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Run scan" });
    expect(api).toHaveBeenCalledWith(
      "/api/admin/health-snapshot?check_type=unindexed_files&fresh=1",
      "GET",
      undefined,
      expect.anything(),
    );
    view.unmount();
    expect(streams.every((s) => s.close.mock.calls.length > 0)).toBe(true);
  });
  it("keeps the existing scan role gate and neutral risk instruments", async () => {
    mount(false);
    await ready();
    expect(
      screen.queryByRole("button", { name: "Run scan" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("high", { exact: true }).length).toBeGreaterThan(
      0,
    );
    expect(
      document.querySelector('[data-segment][data-active="true"]'),
    ).toBeInTheDocument();
  });
  it("names loading, empty and retry states without decorative icons", async () => {
    vi.mocked(api).mockImplementation(() => new Promise(() => {}));
    const view = mount();
    expect(
      screen.getByRole("status", { name: "Loading health issues" }),
    ).toBeInTheDocument();
    view.unmount();
    vi.mocked(api).mockResolvedValue({
      ...fixture.health,
      issues: [],
      counts: {},
    } as never);
    const empty = mount();
    await screen.findByText("No open issues recorded");
    expect(empty.container.querySelector("svg.lucide")).toBeNull();
    empty.unmount();
    vi.mocked(api).mockRejectedValue(new Error("sample unavailable"));
    mount();
    await screen.findByRole("alert");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry" }));
    expect(api).toHaveBeenCalledWith(
      "/api/admin/health-snapshot?fresh=1",
      "GET",
      undefined,
      expect.anything(),
    );
  });
});

describe("Health issue queue composition", () => {
  it("foregrounds cases and keeps activity/catalog secondary", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    expect(
      screen.getByRole("heading", { name: "4 recorded issues" }),
    ).toBeVisible();
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName(
      "Artist Layout Fix",
    );
    expect(screen.queryByText("Repair lanes")).not.toBeInTheDocument();
    expect(screen.queryByText("Latest repair impact")).not.toBeInTheDocument();
    const activity = screen.getByText("Latest activity", {
      selector: "summary",
    });
    expect(activity.closest("details")).not.toHaveAttribute("open");
    await user.click(activity);
    expect(screen.getByText("4 issues found")).toBeVisible();
    expect(screen.getByRole("link", { name: "View task log" })).toHaveAttribute(
      "href",
      "/tasks?task=sample-health-repair",
    );
    await user.click(
      screen.getByText("Available checks (4)", { selector: "summary" }),
    );
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
  });
  it("does not call missing results healthy or infer a complete library scan", async () => {
    sampleHealth.issues = [];
    sampleHealth.counts = {};
    sampleHealth.runs = {};
    mount();
    await screen.findByRole("heading", { name: "No check result available" });
    expect(screen.queryByText(/Library is healthy/)).not.toBeInTheDocument();
    expect(screen.getByText("Latest check: unavailable")).toBeVisible();
  });
  it("distinguishes explicit no-open-issues records and stale data from healthy coverage", async () => {
    sampleHealth.issues = [];
    sampleHealth.counts = {};
    sampleHealth.snapshot.stale = true;
    mount();
    await screen.findByRole("heading", { name: "No open issues recorded" });
    expect(
      screen.getByText("Recorded results may be out of date."),
    ).toBeVisible();
    expect(
      screen.queryByText(/Library is healthy|Healthy checks/),
    ).not.toBeInTheDocument();
  });
  it("labels a limited snapshot instead of pretending all cases are visible", async () => {
    sampleHealth.counts.unindexed_files = 600;
    mount();
    const toggle = await ready();
    expect(
      screen.getByRole("heading", { name: "603 recorded issues" }),
    ).toBeVisible();
    expect(screen.getByText("Showing 4 of 603 recorded issues.")).toBeVisible();
    await userEvent.setup().click(toggle);
    expect(
      screen.getByText("Showing 1 of 600 recorded issues for this check."),
    ).toBeVisible();
  });
  it("keeps catalog failure usable without inventing repair support", async () => {
    missingCatalog = true;
    mount();
    await userEvent.setup().click(await ready());
    const region = screen.getByRole("region", {
      name: "Unindexed Files issues",
    });
    expect(
      within(region).getByText(
        "Repair options are unavailable. You can still review these issues.",
      ),
    ).toBeVisible();
    expect(
      within(region).queryByRole("button", { name: /Queue repair/ }),
    ).not.toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Mark as resolved" }),
    ).toBeVisible();
  });
  it("keeps unlinked cases and their actions without inventing an artist review link", async () => {
    const issue = sampleHealth.issues.find(
      (i) => i.check_type === "artist_layout_fix",
    )!;
    Object.assign(issue, {
      artist_id: null,
      details_json: { path: "/music/unlinked/102.flac" },
    });
    mount();
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Review issues: Artist Layout Fix",
      }),
    );
    const region = within(
      screen.getByRole("region", { name: "Artist Layout Fix issues" }),
    );
    expect(region.getByText("Not linked to an artist (1)")).toBeVisible();
    expect(region.getByText("/music/unlinked/102.flac")).toBeVisible();
    expect(
      region.getByRole("button", { name: "Mark as resolved" }),
    ).toBeVisible();
    expect(
      region.queryByRole("link", { name: "Review and repair" }),
    ).not.toBeInTheDocument();
  });
  it("clears a zero-match filter while retaining the library count", async () => {
    sampleHealth.issues = sampleHealth.issues.filter(
      (i) => i.check_type !== "unindexed_files",
    );
    mount();
    await screen.findByRole("button", {
      name: "Review issues: Artist Layout Fix",
    });
    const user = userEvent.setup();
    await user.click(
      screen.getByText("Filter issues", { selector: "summary" }),
    );
    await user.click(
      screen.getByRole("button", { name: /^Unindexed Files\s*1$/ }),
    );
    await screen.findByRole("heading", {
      name: "No loaded issues for this filter",
    });
    expect(
      screen.getByText("4 open issues recorded across the library."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    await screen.findByRole("button", {
      name: "Review issues: Artist Layout Fix",
    });
    expect(api).toHaveBeenLastCalledWith(
      "/api/admin/health-snapshot",
      "GET",
      undefined,
      expect.anything(),
    );
  });
});

it("describes check-wide bulk repair without presenting loaded cases as its complete scope", async () => {
  sampleHealth.counts.artist_layout_fix = 600;
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Review issues: Artist Layout Fix",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "Queue repair for Artist Layout Fix" }),
  );
  const dialog = screen.getByRole("alertdialog", {
    name: "Queue artist repairs",
  });
  expect(dialog).toHaveAccessibleDescription(
    /across the library.*1 auto-fixable in the loaded results.*600 open issues recorded for this check/,
  );
  expect(api).not.toHaveBeenCalledWith(
    "/api/manage/health-issues/fix-type/artist_layout_fix",
    "POST",
  );
});
