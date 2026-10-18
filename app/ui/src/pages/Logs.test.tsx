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
  onmessage: ((event: MessageEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
}[] = [];
beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue(snapshot);
  streams.length = 0;
  vi.stubGlobal("EventSource", function (url: string) {
    const stream = { url, onmessage: null, close: vi.fn() };
    streams.push(stream);
    return stream;
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("Logs typographic controls", () => {
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
    renderWithAdminProviders(<Logs />);
    await screen.findByRole("heading", { name: "Logs" });
    expect(
      screen.getByRole("button", { name: "Refresh" }).querySelector("svg"),
    ).toBeNull();
    expect(screen.getByText("3 lines").querySelector("svg")).toBeNull();
    expect(screen.getByText(/workers online/).querySelector("svg")).toBeNull();
    expect(screen.getByText("1 errors")).toHaveAttribute(
      "data-tone",
      "warning",
    );
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
