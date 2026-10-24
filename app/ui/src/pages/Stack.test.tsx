import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshot from "../../../../tests/admin-e2e/fixtures/stack-snapshot.json";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Stack } from "./Stack";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
let stream: {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
};
const created = vi.fn();
beforeEach(() => {
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) =>
      path.includes("/logs?")
        ? { name: "worker", logs: "Sample service log" }
        : snapshot,
    );
  created.mockClear();
  vi.stubGlobal("EventSource", function (url: string) {
    created(url);
    stream = { onopen: null, onmessage: null, onerror: null, close: vi.fn() };
    return stream;
  });
  vi.spyOn(window, "setTimeout");
});
afterEach(() => {
  for (const result of vi.mocked(window.setTimeout).mock.results)
    if (result.type === "return") window.clearTimeout(result.value);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Stack typographic controls", () => {
  it("keeps restart confirmation pending until acceptance and recoverable on rejection", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(api).mockImplementation((_path, method) =>
      method === "POST"
        ? new Promise((_resolve, fail) => {
            reject = fail;
          })
        : Promise.resolve(snapshot),
    );
    const user = userEvent.setup();
    renderWithAdminProviders(<Stack />);
    await user.click(
      await screen.findByRole("button", { name: "Restart service worker" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Restart",
      }),
    );
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    ).toBeDisabled();
    await act(async () => reject(new Error("offline")));
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Restart",
      }),
    ).toBeEnabled();
  });
  it("discards a late log response after another service is selected", async () => {
    let finishWorker!: (value: unknown) => void;
    vi.mocked(api).mockImplementation((path) => {
      if (path.includes("/worker/logs?"))
        return new Promise((resolve) => {
          finishWorker = resolve;
        });
      if (path.includes("/scanner/logs?"))
        return Promise.resolve({
          name: "scanner",
          logs: "Scanner selected logs",
        });
      return Promise.resolve(snapshot);
    });
    const user = userEvent.setup();
    renderWithAdminProviders(<Stack />);
    await screen.findByRole("heading", { name: "Stack" });
    await user.click(
      screen.getByRole("button", { name: "Show logs for worker" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Show logs for scanner" }),
    );
    await screen.findByText("Scanner selected logs");
    await act(async () =>
      finishWorker({ name: "worker", logs: "Obsolete worker logs" }),
    );
    expect(
      within(
        screen.getByRole("region", { name: "Logs for scanner" }),
      ).getByText("Scanner selected logs"),
    ).toBeVisible();
    expect(screen.queryByText("Obsolete worker logs")).toBeNull();
  });
  it("distinguishes unavailable logs from an empty log response and retries the same service", async () => {
    let attempts = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (!path.includes("/logs?")) return snapshot;
      if (attempts++ === 0) throw new Error("network unavailable");
      return { name: "worker", logs: "" };
    });
    const user = userEvent.setup();
    renderWithAdminProviders(<Stack />);
    await screen.findByRole("heading", { name: "Stack" });
    await user.click(
      screen.getByRole("button", { name: "Show logs for worker" }),
    );
    const region = screen.getByRole("region", { name: "Logs for worker" });
    expect(await within(region).findByRole("alert")).toHaveTextContent(
      "Could not load logs for worker.",
    );
    expect(
      within(region).queryByText("No logs available for this service."),
    ).toBeNull();
    await user.click(within(region).getByRole("button", { name: "Retry" }));
    expect(
      await within(region).findByText("No logs available for this service."),
    ).toBeVisible();
    expect(attempts).toBe(2);
  });
  it("uses the shared page loading state before services arrive", async () => {
    vi.mocked(api).mockReturnValue(new Promise(() => {}));
    renderWithAdminProviders(<Stack />);
    expect(
      await screen.findByRole("status", { name: "Loading stack services" }),
    ).toHaveAttribute("data-variant", "page");
  });
  it("does not turn a failed fetch into a false Docker-unavailable snapshot", async () => {
    vi.mocked(api).mockRejectedValue(new Error("network unavailable"));
    renderWithAdminProviders(<Stack />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load Docker stack status",
    );
    expect(screen.queryByText("Docker unavailable")).not.toBeInTheDocument();
  });
  it("keeps the last stack snapshot visible when refresh fails and marks SSE recovery", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes("fresh=1")) throw new Error("network unavailable");
      return path.includes("/logs?")
        ? { name: "worker", logs: "Sample service log" }
        : snapshot;
    });
    const user = userEvent.setup();
    renderWithAdminProviders(<Stack />);
    await screen.findByRole("heading", { name: "Stack" });

    act(() => stream.onerror?.(new Event("error")));
    expect(screen.getByText("Reconnecting")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Showing the last successful snapshot.",
    );
    expect(screen.getByText("Docker available")).toBeVisible();
  });
  it("uses shared icon-only service actions without raised nested cards", async () => {
    renderWithAdminProviders(<Stack />);
    await screen.findByRole("heading", { name: "Stack" });
    expect(
      screen.getByRole("button", { name: "Refresh" }).querySelector("svg"),
    ).toHaveAttribute("data-admin-ux", "header-refresh");
    expect(
      screen.getByRole("article", { name: "Service worker" }),
    ).not.toHaveClass("bg-raised-surface");
    const restart = screen.getByRole("button", {
      name: "Restart service worker",
    });
    const logs = screen.getByRole("button", { name: "Show logs for worker" });
    const stop = screen.getByRole("button", { name: "Stop service worker" });
    const start = screen.getByRole("button", { name: "Start service scanner" });
    const external = screen.getByRole("link", { name: "Open service tidarr" });
    expect(external).toHaveAttribute("href", "https://search.lespedants.org");
    expect(external).toHaveAttribute("target", "_blank");
    for (const action of [restart, logs, stop, start, external]) {
      expect(action).toHaveAttribute("data-variant", "ghost");
      expect(action).toHaveAttribute("data-size", "icon-lg");
      expect(action).toHaveTextContent(/^$/);
      expect(action.querySelectorAll("svg")).toHaveLength(1);
      expect(action.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(action).not.toHaveAttribute("title");
    }
  });
  it("keeps disabled restart discoverable with the shared tooltip", async () => {
    renderWithAdminProviders(<Stack />);
    const restart = await screen.findByRole("button", {
      name: "Restart service scanner",
    });
    expect(restart).toBeDisabled();
    const wrapper = screen.getByRole("group", {
      name: "Restart service scanner",
    });
    expect(wrapper).toHaveAttribute("aria-disabled", "true");
    expect(wrapper).toHaveAttribute("tabindex", "0");
    wrapper.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Restart");
    expect(api).not.toHaveBeenCalledWith(expect.anything(), "POST");
  });
  it("keeps the catalogue summary stable while the service count follows filters", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<Stack />);
    const summary = await screen.findByRole("region", {
      name: "Stack summary",
    });
    const running = within(summary).getByText("Running services").parentElement;
    expect(running).toHaveTextContent("2/ 3Running services");
    expect(
      within(summary).getByText("Stopped services").parentElement,
    ).toHaveTextContent("1Stopped services");
    const services = screen.getByRole("region", { name: "Services" });
    expect(within(services).getByText("3 / 3")).toHaveAttribute(
      "data-variant",
      "counter",
    );
    await user.click(screen.getByRole("radio", { name: "Stopped" }));
    expect(within(services).getByText("1 / 3")).toHaveAttribute(
      "data-variant",
      "counter",
    );
    expect(running).toHaveTextContent("2/ 3Running services");
    expect(
      screen.queryByRole("heading", { name: "Service filters" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("2/3 running")).not.toBeInTheDocument();
  });
  it("uses shared MonoLabels and semantic InfoBadge tones for service metadata", async () => {
    renderWithAdminProviders(<Stack />);
    await screen.findByRole("heading", { name: "Stack" });

    const runningService = screen.getByRole("article", {
      name: "Service worker",
    });
    const runningBadge = within(runningService)
      .getByText("running", { exact: true })
      .closest('[data-slot="info-badge"]');
    expect(runningBadge).toHaveAttribute("data-tone", "success");
    expect(runningBadge?.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(within(runningService).getByText("Status")).toHaveClass(
      "crate-mono-label",
    );
    expect(within(runningService).getByText("Ports")).toHaveClass(
      "crate-mono-label",
    );
    expect(within(runningService).getByText("Public route")).toHaveClass(
      "crate-mono-label",
    );
    for (const label of ["Status", "Ports", "Public route"]) {
      expect(within(runningService).getByText(label).tagName).toBe("DT");
    }
    for (const value of ["Up 2 hours", "No exposed ports", "Internal only"]) {
      const reading = within(runningService).getByText(value);
      expect(reading.tagName).toBe("DD");
      expect(reading).toHaveClass("font-mono", "font-normal");
    }
    expect(within(runningService).getByText("crate-worker:sample")).toHaveClass(
      "font-mono",
      "wrap-anywhere",
    );

    const stoppedService = screen.getByRole("article", {
      name: "Service scanner",
    });
    expect(
      within(stoppedService)
        .getByText("exited", { exact: true })
        .closest('[data-slot="info-badge"]'),
    ).toHaveAttribute("data-tone", "neutral");
  });
  it("keeps timestamped logs once, preserving duplicate lines in a bounded reading", async () => {
    const line = "2026-10-24T12:34:56Z Worker heartbeat ready";
    vi.mocked(api).mockImplementation(async (path) =>
      path.includes("/logs?")
        ? { name: "worker", logs: `${line}\n${line}` }
        : snapshot,
    );
    const user = userEvent.setup();
    renderWithAdminProviders(<Stack />);
    await user.click(
      await screen.findByRole("button", { name: "Show logs for worker" }),
    );
    const region = screen.getByRole("region", { name: "Logs for worker" });
    const logReading = await within(region).findByText(`${line} ${line}`);
    expect(logReading.tagName).toBe("PRE");
    expect(logReading.textContent).toBe(`${line}\n${line}`);
    expect(within(region).queryByText("12:34:56")).not.toBeInTheDocument();
  });
  it("keeps disclosure keyboard semantics, logs loading and closing", async () => {
    let resolveLogs: (value: unknown) => void = () => {};
    vi.mocked(api).mockImplementation((path) =>
      path.includes("/logs?")
        ? new Promise((resolve) => {
            resolveLogs = resolve;
          })
        : Promise.resolve(snapshot),
    );
    renderWithAdminProviders(<Stack />);
    const show = await screen.findByRole("button", {
      name: "Show logs for worker",
    });
    const user = userEvent.setup();
    show.focus();
    await user.keyboard(" ");
    const hide = screen.getByRole("button", { name: "Hide logs for worker" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "Logs for worker" });
    expect(region.id).toBe(hide.getAttribute("aria-controls"));
    expect(within(region).getByRole("status")).toHaveAccessibleName(
      "Loading logs for worker",
    );
    expect(within(region).getByTestId("loading-state")).toHaveAttribute(
      "data-variant",
      "section",
    );
    await act(async () =>
      resolveLogs({ name: "worker", logs: "Sample service log" }),
    );
    expect(within(region).getByText("Sample service log")).toBeVisible();
    await user.click(hide);
    expect(region).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(
      "/api/stack/container/worker/logs?tail=30",
    );
  });
  it("preserves start/stop callbacks and busy state", async () => {
    let resolveAction: (value: unknown) => void = () => {};
    vi.mocked(api).mockImplementation((_path, method) =>
      method === "POST"
        ? new Promise((resolve) => {
            resolveAction = resolve;
          })
        : Promise.resolve(snapshot),
    );
    renderWithAdminProviders(<Stack />);
    const stop = await screen.findByRole("button", {
      name: "Stop service worker",
    });
    await userEvent.setup().click(stop);
    expect(stop).toBeDisabled();
    expect(stop).toHaveAttribute("aria-busy", "true");
    expect(api).toHaveBeenCalledWith(
      "/api/stack/container/worker/stop",
      "POST",
    );
    await act(async () => resolveAction({}));
    expect(stop).toBeEnabled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Start service scanner" }));
    expect(api).toHaveBeenCalledWith(
      "/api/stack/container/scanner/start",
      "POST",
    );
    await act(async () => resolveAction({}));
  });
  it("keeps restart confirmation and cancellation with focus restoration", async () => {
    renderWithAdminProviders(<Stack />);
    const user = userEvent.setup();
    const restart = await screen.findByRole("button", {
      name: "Restart service worker",
    });
    await user.click(restart);
    let dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(restart).toHaveFocus();
    expect(api).not.toHaveBeenCalledWith(expect.anything(), "POST");
    await user.click(restart);
    dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Restart" }));
    expect(api).toHaveBeenCalledWith(
      "/api/stack/container/worker/restart",
      "POST",
    );
    expect(
      screen.getByRole("button", { name: "Restart service scanner" }),
    ).toBeDisabled();
  });
  it("preserves filters, refresh, stream updates and cleanup", async () => {
    const { unmount } = renderWithAdminProviders(<Stack />);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Stack" });
    const filters = screen.getByRole("radiogroup", { name: "Service state" });
    const all = within(filters).getByRole("radio", { name: "All" });
    all.focus();
    await user.keyboard("{ArrowRight}");
    expect(
      within(filters).getByRole("radio", { name: "Running" }),
    ).toHaveFocus();
    expect(
      within(filters).getByRole("radio", { name: "Running" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByText("scanner", { exact: true }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Stopped" }));
    expect(
      screen.queryByText("worker", { exact: true }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "All" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search stack services" }),
      "8686",
    );
    expect(screen.getByText("tidarr", { exact: true })).toBeVisible();
    expect(created).toHaveBeenCalledOnce();
    act(
      () =>
        stream.onmessage?.({
          data: JSON.stringify({
            ...snapshot,
            stack: { ...snapshot.stack, containers: [] },
          }),
          origin: window.location.origin,
        } as MessageEvent),
    );
    expect(
      screen.getByText("No services match the current filters."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(api).toHaveBeenCalledWith("/api/admin/stack-snapshot?fresh=1");
    unmount();
    expect(stream.close).toHaveBeenCalledOnce();
  });
});
