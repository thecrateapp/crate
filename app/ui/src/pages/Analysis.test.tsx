import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import analysis from "../../../../tests/admin-e2e/fixtures/analysis-status.json";
import { useOpsSnapshot } from "@/contexts/OpsSnapshotContext";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Analysis } from "./Analysis";
vi.mock("@/contexts/OpsSnapshotContext", () => ({ useOpsSnapshot: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/components/SmartMixCoverage", () => ({
  SmartMixCoverage: () => <div>Smart Mix coverage sample</div>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn(async () => {});
function snapshot(overrides: Partial<ReturnType<typeof useOpsSnapshot>> = {}) {
  vi.mocked(useOpsSnapshot).mockReturnValue({
    data: { analysis } as ReturnType<typeof useOpsSnapshot>["data"],
    loading: false,
    error: null,
    refresh,
    ...overrides,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockReset().mockResolvedValue({ task_id: "sample" });
  snapshot();
  vi.spyOn(window, "setTimeout");
});
afterEach(() => {
  for (const result of vi.mocked(window.setTimeout).mock.results)
    if (result.type === "return") window.clearTimeout(result.value);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const actions = [
  [
    "Backfill fingerprints",
    "/api/tasks/backfill-track-fingerprints",
    undefined,
    "Audio fingerprint backfill queued",
    "fingerprints",
  ],
  [
    "Recompute popularity",
    "/api/manage/compute-popularity",
    undefined,
    "Popularity recomputation queued",
    "popularity",
  ],
  [
    "Recompute bliss",
    "/api/manage/compute-bliss",
    undefined,
    "Bliss recomputation queued",
    "bliss",
  ],
  [
    "Re-analyze all",
    "/api/manage/analyze-all",
    undefined,
    "Full audio re-analysis queued",
    "analysis",
  ],
  [
    "Sync lyrics",
    "/api/manage/sync-lyrics",
    { limit: 1000 },
    "Lyrics sync queued",
    "lyrics",
  ],
  [
    "Write metadata",
    "/api/manage/portable-metadata",
    { write_audio_tags: true, write_sidecars: true },
    "Portable metadata write queued",
    "portable",
  ],
  [
    "Rehydrate",
    "/api/manage/portable-metadata/rehydrate",
    undefined,
    "Portable metadata rehydrate queued",
    "rehydrate",
  ],
  [
    "Export index",
    "/api/manage/portable-metadata/export-rich",
    { include_audio: false, write_rich_tags: false },
    "Rich metadata export queued",
    "richExport",
  ],
] as const;
describe("Analysis typographic controls", () => {
  it("distinguishes display titles, numeric readouts and technical labels from body copy", () => {
    const { container } = renderWithAdminProviders(<Analysis />);
    for (const title of [
      "Audio features",
      "Audio fingerprints",
      "Lyrics",
      "Portable metadata",
      "Rich exports",
    ])
      expect(screen.getByRole("heading", { name: title })).toHaveClass(
        "font-display",
      );
    for (const field of container.querySelectorAll(".crate-form-field")) {
      expect(field.children[0]).toHaveClass("font-mono", "font-normal");
      expect(field.children[1]).toHaveClass("font-mono", "tabular-nums");
    }
    const latest = screen.getByRole("article", {
      name: "Last audio fingerprint",
    });
    expect(within(latest).getByRole("heading")).toHaveClass(
      "font-mono",
      "font-normal",
    );
    expect(within(latest).getByText("Bruma")).toHaveClass("font-display");
    expect(latest).toHaveClass("border-border-quiet", "bg-raised-surface");
    expect(container.querySelector('[class*="bg-black/"], [class*="border-white/"]')).toBeNull();
    expect(container.querySelector('[class*="text-white/"]')).toBeNull();
  });
  it("names initial loading and retains its functional glyph", () => {
    snapshot({ data: null, loading: true });
    renderWithAdminProviders(<Analysis />);
    const loading = screen.getByRole("status", {
      name: "Loading analysis status",
    });
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
  it("keeps the last analysis snapshot visible when a refresh fails", async () => {
    snapshot({ error: "Snapshot refresh failed" });
    const user = userEvent.setup();
    renderWithAdminProviders(<Analysis />);

    expect(
      screen.getByText(
        "Analysis status could not refresh. Showing the last successful snapshot.",
      ),
    ).toBeVisible();
    expect(screen.getByText("1,200 tracks")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledWith(true);
  });
  it("keeps named header actions and text coverage, sections and recent outputs", () => {
    const { container } = renderWithAdminProviders(<Analysis />);
    expect(screen.getByRole("heading", { name: "Analysis" })).toBeVisible();
    expect(container.querySelectorAll("svg")).toHaveLength(5);
    expect(
      container.querySelectorAll('svg[data-admin-ux^="header-"]'),
    ).toHaveLength(5);
    expect(screen.getByText("1,200 tracks").tagName).toBe("SPAN");
    for (const text of [
      "75% audio covered",
      "50% bliss covered",
      "91.7% fingerprinted",
      "90% lyrics cached",
      "80% portable albums",
      "Chromaprint ready",
      "15 active",
      "4 failed",
    ])
      expect(screen.getByText(text).querySelector("svg")).toBeNull();
    expect(screen.getByText("4 failed")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(
      screen.getByRole("heading", { name: "Audio features" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Last analyzed track" }),
    ).toBeVisible();
    expect(screen.getByText("Marea")).toBeVisible();
    expect(screen.getByText("Horizonte")).toBeVisible();
    expect(screen.getByText("Bruma")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Operator notes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recent outputs" }),
    ).toBeVisible();
    expect(screen.getByText("123 BPM")).toBeVisible();
    expect(screen.getByText("72% energy")).toBeVisible();
  });

  it.each([
    ["chromaprint-v1", "Chromaprint"],
    ["pcm16-md5-v1", "PCM fallback"],
    ["future-v2", "future-v2"],
    [undefined, "Source unavailable"],
  ])(
    "shows the latest fingerprint with its own source: %s",
    (source, label) => {
      snapshot({
        data: {
          analysis: {
            ...analysis,
            last_fingerprinted: { ...analysis.last_fingerprinted, source },
          },
        } as ReturnType<typeof useOpsSnapshot>["data"],
      });
      renderWithAdminProviders(<Analysis />);
      const card = screen.getByRole("article", {
        name: "Last audio fingerprint",
      });
      expect(within(card).getByText("Bruma")).toBeVisible();
      expect(within(card).getByText(label!)).toBeVisible();
      expect(
        within(card).queryByText(/Similarity vectors/),
      ).not.toBeInTheDocument();
      expect(card.querySelector("svg")).toBeNull();
    },
  );
  it("accepts older snapshots without a recent fingerprint", () => {
    const legacy = { ...analysis, last_fingerprinted: undefined };
    snapshot({
      data: { analysis: legacy } as ReturnType<typeof useOpsSnapshot>["data"],
    });
    renderWithAdminProviders(<Analysis />);
    const card = screen.getByRole("article", {
      name: "Last audio fingerprint",
    });
    expect(
      within(card).getByText("No recent output recorded yet."),
    ).toBeVisible();
    expect(screen.getByText("Marea")).toBeVisible();
    expect(screen.getByText("Horizonte")).toBeVisible();
  });
  it("keeps a dated fingerprint even when its track title is missing", () => {
    snapshot({
      data: {
        analysis: {
          ...analysis,
          last_fingerprinted: {
            ...analysis.last_fingerprinted,
            title: null,
            source: null,
          },
        },
      } as ReturnType<typeof useOpsSnapshot>["data"],
    });
    renderWithAdminProviders(<Analysis />);
    const card = screen.getByRole("article", {
      name: "Last audio fingerprint",
    });
    expect(within(card).getByText("Untitled track")).toBeVisible();
    expect(within(card).getByText("Source unavailable")).toBeVisible();
  });
  it.each(actions)(
    "preserves %s queue, busy state, recovery and delayed refresh",
    async (name, path, body, success, marker) => {
      let resolveTask: (value: unknown) => void = () => {};
      vi.mocked(api).mockReturnValue(
        new Promise((resolve) => {
          resolveTask = resolve;
        }),
      );
      const user = userEvent.setup();
      renderWithAdminProviders(<Analysis />);
      const action = screen.getByRole("button", { name });
      action.focus();
      await user.keyboard("{Enter}");
      expect(api).toHaveBeenCalledExactlyOnceWith(path, "POST", body);
      for (const [label] of actions)
        expect(screen.getByRole("button", { name: label })).toBeDisabled();
      expect(action).toHaveAttribute("aria-busy", "true");
      expect(
        action.querySelector(`[data-admin-ux="analysis-action-${marker}"]`),
      ).toHaveAttribute("aria-hidden", "true");
      await act(async () => resolveTask({ task_id: "sample" }));
      expect(toast.success).toHaveBeenCalledWith(success);
      for (const [label] of actions)
        expect(screen.getByRole("button", { name: label })).toBeEnabled();
      expect(action).not.toHaveAttribute("aria-busy");
      if (action.closest('[data-slot="admin-page-header"]')) {
        expect(action.querySelector("svg")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        expect(
          action.querySelector("svg")?.getAttribute("data-admin-ux"),
        ).toMatch(/^header-/);
      } else expect(action.querySelector("svg")).toBeNull();
      expect(refresh).not.toHaveBeenCalled();
      const delayed = vi
        .mocked(window.setTimeout)
        .mock.calls.find(([, delay]) => delay === 800);
      expect(delayed).toBeDefined();
      await act(async () => {
        (delayed![0] as () => void)();
      });
      expect(refresh).toHaveBeenCalledExactlyOnceWith(true);
    },
  );
  it("keeps manual refresh and failure retry without queuing twice", async () => {
    vi.mocked(api).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderWithAdminProviders(<Analysis />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledWith(true);
    refresh.mockClear();
    await user.click(screen.getByRole("button", { name: "Sync lyrics" }));
    expect(toast.error).toHaveBeenCalledWith(
      "The analysis task could not be queued",
    );
    expect(screen.getByRole("button", { name: "Sync lyrics" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
  });
  it.each(["error", "missing"])("keeps the %s status retry", async (state) => {
    snapshot({
      data: null,
      error: state === "error" ? "Sample unavailable" : null,
    });
    renderWithAdminProviders(<Analysis />);
    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByText(
        state === "error"
          ? "Sample unavailable"
          : "No analysis status available",
      ),
    ).toBeVisible();
    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("preserves empty coverage, fallback and recent output states", () => {
    const empty = Object.fromEntries(
      Object.entries(analysis).map(([key, value]) => [
        key,
        typeof value === "number" ? 0 : value,
      ]),
    );
    snapshot({
      data: {
        analysis: {
          ...analysis,
          ...empty,
          chromaprint_available: false,
          last_analyzed: {},
          last_bliss: {},
          last_fingerprinted: {},
        },
      } as ReturnType<typeof useOpsSnapshot>["data"],
    });
    renderWithAdminProviders(<Analysis />);
    expect(screen.getAllByText("0 tracks")).toHaveLength(2);
    expect(screen.getByText("0% audio covered")).toBeVisible();
    expect(screen.getAllByText("PCM fallback")).toHaveLength(2);
    expect(screen.getAllByText("No recent output recorded yet.")).toHaveLength(
      3,
    );
    expect(screen.queryByText(/\d+ active/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
