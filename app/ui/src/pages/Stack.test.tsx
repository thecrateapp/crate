import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshot from "../../../../tests/admin-e2e/fixtures/stack-snapshot.json";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Stack } from "./Stack";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
let stream: {
  onmessage: ((event: MessageEvent) => void) | null;
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
    stream = { onmessage: null, close: vi.fn() };
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
  it("names initial loading while retaining the busy glyph", () => {
    vi.mocked(api).mockReturnValue(new Promise(() => {}));
    renderWithAdminProviders(<Stack />);
    expect(
      screen.getByRole("status", { name: "Loading stack services" }),
    ).toHaveAttribute("aria-busy", "true");
  });
  it("names service actions, removes redundant summary/refresh/restart glyphs and preserves UX", async () => {
    renderWithAdminProviders(<Stack />);
    await screen.findByRole("heading", { name: "Stack" });
    expect(
      screen.getByRole("button", { name: "Refresh" }).querySelector("svg"),
    ).toHaveAttribute("data-admin-ux", "header-refresh");
    expect(screen.getByText("2/3 running").querySelector("svg")).toBeNull();
    expect(screen.getByText("1 public routes").querySelector("svg")).toBeNull();
    const restart = screen.getByRole("button", {
      name: "Restart service worker",
    });
    expect(restart).toHaveTextContent("Restart");
    expect(restart.querySelector("svg")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Stop service worker" }),
    ).toHaveTextContent("Stop");
    expect(
      screen.getByRole("button", { name: "Start service scanner" }),
    ).toHaveTextContent("Start");
    const external = screen.getByRole("link", { name: "Open service tidarr" });
    expect(external).toHaveAttribute("href", "https://search.lespedants.org");
    expect(external).toHaveAttribute("target", "_blank");
    expect(external.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
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
    expect(within(region).getByRole("status")).toHaveAttribute(
      "aria-busy",
      "true",
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
    act(() =>
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
