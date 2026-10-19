import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalCatalog } from "./GlobalCatalog";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import fixture from "../../../../tests/admin-e2e/fixtures/global-catalog-1ak.json";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const mockApi = vi.mocked(api);
const statusUrl = "/api/admin/global-catalog/status",
  runsUrl = "/api/admin/global-catalog/runs?limit=25",
  duplicatesUrl = "/api/admin/global-catalog/duplicates?limit=50";
let data: Record<string, unknown>;
function mount(capabilities = ["federation.policy.manage"]) {
  return renderWithAdminProviders(<GlobalCatalog />, {
    route: "/global-catalog",
    auth: {
      hasAnyCapability: (required) =>
        required.some((cap) => capabilities.includes(cap)),
    },
  });
}
async function ready(capabilities?: string[]) {
  const v = mount(capabilities);
  await screen.findByText("Global ready");
  return v;
}
beforeEach(() => {
  vi.clearAllMocks();
  data = structuredClone(fixture);
  mockApi.mockImplementation(async (path, method) => {
    if (method === "POST")
      return { task_id: "sample-catalog-task", status: "queued" };
    if (!(path in data)) throw new Error(`Unexpected GET ${path}`);
    return structuredClone(data[path]);
  });
});
afterEach(cleanup);
describe("Global Catalog presentation with real hook and page handlers", () => {
  it("retires redundant glyphs and uses display/mono readouts with shared8px pairs", async () => {
    await ready();
    expect(document.querySelectorAll("svg:not([data-admin-ux])")).toHaveLength(
      0,
    );
    expect(screen.getByRole("heading", { name: "Global Catalog" })).toHaveClass(
      "font-display",
    );
    expect(document.querySelectorAll(".crate-form-field")).toHaveLength(4);
    expect(screen.getByText("Artists")).toHaveClass("font-mono");
    expect(screen.getByText("24")).toHaveClass("font-display");
    expect(screen.getByText("sample-run-20261018")).toHaveClass("font-mono");
    for (const button of screen.getAllByRole("button"))
      if (button.closest('[data-slot="admin-page-header"]'))
        expect(button).toHaveAttribute("data-size", "icon-lg");
      else expect(button).toHaveClass("min-h-11");
    expect(mockApi.mock.calls.map(([path]) => path).sort()).toEqual(
      [statusUrl, runsUrl, duplicatesUrl].sort(),
    );
  });
  it.each([
    [
      "global-ready",
      "Global ready",
      "Serving the current complete global catalog.",
      "on",
    ],
    [
      "global-refreshing",
      "Global refreshing",
      "Reconciliation in progress; serving the last complete global catalog.",
      "off",
    ],
    [
      "global-degraded",
      "Global degraded",
      "Reconciliation failed; serving the last complete global catalog.",
      "warn",
    ],
    [
      "local-fallback",
      "Local fallback",
      "First reconciliation in progress; local reads remain available.",
      "off",
    ],
  ])(
    "preserves %s words and transfers status accent to its content",
    async (mode, label, description, tone) => {
      data[statusUrl] = { ...fixture[statusUrl], serving_mode: mode };
      mount();
      const state = await screen.findByText(label);
      expect(state.closest("[data-tone]")).toHaveAttribute("data-tone", tone);
      expect(screen.getByText(description)).toBeInTheDocument();
      expect(screen.getByText("Stale peers: 1")).toBeInTheDocument();
      expect(
        screen.getByText("Unresolved match candidates: 2"),
      ).toBeInTheDocument();
    },
  );
  it("keeps native view selection, data order and duplicate source details without new reads", async () => {
    await ready();
    const runs = screen.getByRole("button", { name: "Runs" });
    runs.focus();
    await userEvent.keyboard("{Enter}");
    expect(runs).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getAllByText(/^sample-run-/).map((el) => el.textContent),
    ).toEqual(["sample-run-20261018", "sample-run-older"]);
    expect(screen.getByText("Sample peer unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("Seen 118")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Duplicates" }));
    expect(
      screen.getByText("sample-album:uncertain-match"),
    ).toBeInTheDocument();
    expect(screen.getByText("sample-local-41")).toBeInTheDocument();
    expect(screen.getByText("sample-peer-2")).toBeInTheDocument();
    expect(screen.getByText("title_artist")).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledTimes(3);
  });
  it.each([
    { caps: [] },
    { caps: ["library.tidal.manage"] },
    { caps: ["federation.view"] },
  ])("does not permit management for capabilities %j", async ({ caps }) => {
    await ready(caps);
    expect(screen.getByRole("button", { name: "Reconcile" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Full rebuild" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Full rebuild" }));
    expect(mockApi.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });
  it("refreshes only status and preserves the selected view", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Runs" }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mockApi.mock.calls.map(([path]) => path)).toEqual([
      statusUrl,
      runsUrl,
      duplicatesUrl,
      statusUrl,
    ]);
    expect(screen.getByText("Reconciliation Runs")).toBeInTheDocument();
  });
  it.each(["incremental", "full"] as const)(
    "retains exact %s mode, locks the POST and dispatches asynchronous refreshes",
    async (mode) => {
      await ready();
      let finishPost!: (value: unknown) => void;
      mockApi.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishPost = resolve;
          }),
      );
      await userEvent.click(
        screen.getByRole("button", {
          name: mode === "full" ? "Full rebuild" : "Reconcile",
        }),
      );
      const selected = screen.getByRole("button", {
        name: mode === "full" ? "Full rebuild" : "Reconcile",
      });
      expect(selected).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: "Reconcile" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Full rebuild" }),
      ).toBeDisabled();
      expect(
        document.querySelector(`[data-admin-ux="catalog-${mode}-loading"]`),
      ).toHaveAttribute("aria-hidden", "true");
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/global-catalog/reconcile",
        "POST",
        { mode },
      );
      const pending = new Map<string, (value: unknown) => void>();
      mockApi.mockImplementation(
        (path) =>
          new Promise((resolve) => {
            pending.set(path, resolve);
          }),
      );
      await act(async () => finishPost({ task_id: "sample-catalog-task" }));
      expect([...pending.keys()].sort()).toEqual([statusUrl, runsUrl].sort());
      await act(async () =>
        pending.get(statusUrl)!(structuredClone(fixture[statusUrl])),
      );
      expect(selected).toBeEnabled();
      expect(selected).toHaveAttribute("aria-busy", "false");
      await act(async () =>
        pending.get(runsUrl)!(structuredClone(fixture[runsUrl])),
      );
      await waitFor(() => expect(selected).toBeEnabled());
      expect(toast.success).toHaveBeenCalledWith(
        mode === "full"
          ? "Full reconciliation queued"
          : "Incremental reconciliation queued",
      );
      expect(
        mockApi.mock.calls.filter(([path]) => path === duplicatesUrl),
      ).toHaveLength(1);
    },
  );
  it("unlocks on POST rejection without refreshing or replacing the current readings", async () => {
    await ready();
    mockApi.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    expect(toast.error).toHaveBeenCalledWith("Failed to queue reconciliation");
    expect(screen.getByRole("button", { name: "Full rebuild" })).toBeEnabled();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledTimes(4);
  });
  it("preserves empty run/duplicate and last-run messages", async () => {
    data[statusUrl] = { ...fixture[statusUrl], last_run: null };
    data[runsUrl] = { items: [] };
    data[duplicatesUrl] = { items: [] };
    await ready();
    expect(screen.getByText("No reconciliation runs yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Runs" }));
    expect(screen.getByText("No runs found.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Duplicates" }));
    expect(
      screen.getByText(
        "No duplicate candidates above the confidence threshold.",
      ),
    ).toBeInTheDocument();
  });
  it("preserves initial loading and failed-read fallback rather than inventing totals", async () => {
    mockApi.mockReturnValue(new Promise(() => {}));
    const v = mount();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    v.unmount();
    mockApi.mockRejectedValue(new Error("Read unavailable"));
    mount();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    expect(
      screen.getByText("Catalog serving status is unavailable."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(4);
  });
});
