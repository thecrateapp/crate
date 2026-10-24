import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshot from "../../../../tests/admin-e2e/fixtures/logs-snapshot.json";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Logs } from "./Logs";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
const streams: {
  url: string;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
}[] = [];
beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue(snapshot);
  streams.length = 0;
  vi.stubGlobal("EventSource", function (url: string) {
    const stream = {
      url,
      onopen: null,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    };
    streams.push(stream);
    return stream;
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("Logs typographic controls", () => {
  it("lets an operator inspect complete metadata including a long search match", async () => {
    const metadata = {
      album: "Costa Norte",
      details: "Long diagnostic payload ".repeat(40),
      terminal: "needle-at-the-end",
    };
    vi.mocked(api).mockResolvedValue({
      ...snapshot,
      logs: [{ ...snapshot.logs[0], metadata }],
    });
    const user = userEvent.setup();
    renderWithAdminProviders(<Logs />);
    await user.type(
      await screen.findByRole("textbox", { name: "Search worker logs" }),
      "needle-at-the-end",
    );
    await user.click(screen.getByText("Inspect metadata"));
    const details = screen.getByText("Inspect metadata").closest("details");
    expect(details).toHaveAttribute("open");
    expect(details?.querySelector("pre")).toHaveTextContent(
      "needle-at-the-end",
    );
    expect(details?.querySelector("pre")).toHaveClass("overflow-auto");
  });
  it("names initial loading while retaining the busy glyph", () => {
    vi.mocked(api).mockReturnValue(new Promise(() => {}));
    renderWithAdminProviders(<Logs />);
    expect(
      screen.getByRole("status", { name: "Loading worker logs" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      document.querySelector('[data-admin-ux="logs-loading"]'),
    ).not.toBeNull();
  });
  it("retires redundant action and summary glyphs while keeping native live controls", async () => {
    const { container } = renderWithAdminProviders(<Logs />);
    await screen.findByRole("heading", { name: "Logs" });
    expect(
      screen.getByRole("button", { name: "Refresh" }).querySelector("svg"),
    ).toHaveAttribute("data-admin-ux", "header-refresh");
    expect(screen.getByText("3 lines").querySelector("svg")).toBeNull();
    expect(screen.getByText(/workers online/).querySelector("svg")).toBeNull();
    expect(screen.getByText("1 errors")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByText("1 warnings")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(
      screen.getByRole("button", { name: "Pause live" }).querySelector("svg"),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("textbox", { name: "Search worker logs" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Task scan-sam" })).toHaveAttribute(
      "href",
      "/tasks?task=scan-sample-123",
    );
    const worker = screen.getAllByRole("button", {
      name: /log lines seen/,
    })[0]!;
    expect(worker).toHaveClass("border-border-quiet", "bg-raised-surface");
    const stream = screen.getByRole("heading", { name: "Incident stream" })
      .parentElement?.parentElement;
    expect(stream?.querySelector('[class*="bg-[#06080c]"]')).toBeNull();
    expect(container.querySelector('[class*="text-white/"]')).toBeNull();
  });
  it("uses the shared empty state when no worker or log entries are available", async () => {
    vi.mocked(api).mockResolvedValue({
      ...snapshot,
      workers: [],
      logs: [],
    });
    renderWithAdminProviders(<Logs />);
    await screen.findByRole("heading", { name: "Logs" });
    expect(
      screen
        .getByText("No worker heartbeat data available yet.")
        .closest('[data-testid="empty-state"]'),
    ).toBeInTheDocument();
    expect(
      screen
        .getByText("No log lines match the current filters.")
        .closest('[data-testid="empty-state"]'),
    ).toBeInTheDocument();
  });
  it("keeps filters, refresh and live subscription lifetime", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithAdminProviders(<Logs />);
    await screen.findByText("Sample analysis needs attention");
    await user.click(screen.getByRole("radio", { name: "Error" }));
    expect(screen.queryByText("Sample sync waiting")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "All levels" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search worker logs" }),
      "Costa Norte",
    );
    expect(screen.getByText("Sample analysis needs attention")).toBeVisible();
    expect(screen.queryByText("Sample library ready")).not.toBeInTheDocument();
    expect(streams).toHaveLength(1);
    expect(streams[0]!.url).toBe("/api/admin/logs-stream?limit=100");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(api).toHaveBeenCalledWith(
      "/api/admin/logs-snapshot?limit=100&fresh=1",
    );
    expect(
      screen.getByRole("button", { name: "Pause live" }),
    ).not.toHaveAttribute("aria-pressed");
    await user.click(screen.getByRole("button", { name: "Pause live" }));
    expect(
      screen.getByRole("button", { name: "Resume live" }),
    ).not.toHaveAttribute("aria-pressed");
    expect(streams[0]!.close).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Resume live" }));
    expect(streams).toHaveLength(2);
    await user.clear(
      screen.getByRole("textbox", { name: "Search worker logs" }),
    );
    act(() =>
      streams[1]!.onmessage?.({
        data: JSON.stringify({
          ...snapshot,
          logs: [{ ...snapshot.logs[0], message: "Updated stream sample" }],
        }),
      } as MessageEvent),
    );
    expect(screen.getByText("Updated stream sample")).toBeVisible();
    unmount();
    expect(streams[1]!.close).toHaveBeenCalledOnce();
  });
  it("shows stream recovery and preserves the last snapshot after refresh failure", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes("fresh=1")) throw new Error("network unavailable");
      return snapshot;
    });
    const user = userEvent.setup();
    renderWithAdminProviders(<Logs />);
    await screen.findByText("Sample analysis needs attention");

    act(() => streams[0]!.onerror?.(new Event("error")));
    expect(screen.getByText("Reconnecting")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Showing the last successful snapshot.");
    expect(screen.getByText("Sample analysis needs attention")).toBeVisible();
  });
  it("retains error retry", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("unavailable"));
    renderWithAdminProviders(<Logs />);
    const error = await screen.findByRole("alert");
    expect(within(error).getByText("Failed to load worker logs")).toBeVisible();
    await userEvent
      .setup()
      .click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Sample library ready")).toBeVisible();
  });
});
