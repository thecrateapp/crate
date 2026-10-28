import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));
import { BandcampSection } from "./BandcampSection";
describe("Bandcamp settings reads", () => {
  beforeEach(() => {
    mocks.api.mockReset();
  });
  it("retries a failed status read without exposing a disconnected cookie form", async () => {
    mocks.api
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        connected: false,
        status: "disconnected",
        bridge_enabled: false,
      });
    const user = userEvent.setup();
    renderWithListenProviders(<BandcampSection />, { locale: "en" });
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByLabelText("Session cookie")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Session cookie")).toBeVisible();
    expect(mocks.api.mock.calls).toEqual([
      ["/api/bandcamp/me/status"],
      ["/api/bandcamp/me/status"],
    ]);
  });
  it("does not manufacture zero counts when a connected collection read fails", async () => {
    mocks.api.mockImplementation((path: string) =>
      path.endsWith("/status")
        ? Promise.resolve({
            connected: true,
            status: "connected",
            bridge_enabled: false,
            display_name: "Collector",
          })
        : path.endsWith("/collection")
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ total: 12 }),
    );
    renderWithListenProviders(<BandcampSection />, { locale: "en" });
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(/Collection 0/)).toBeNull();
    expect(screen.getByText("Collector", { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "View purchases" })).toBeVisible();
  });
  it("retries only unavailable totals and displays verified zero counts after recovery", async () => {
    let failed = true;
    mocks.api.mockImplementation((path: string) =>
      path.endsWith("/status")
        ? Promise.resolve({
            connected: true,
            status: "connected",
            bridge_enabled: false,
            display_name: "Collector",
          })
        : failed && path.endsWith("/collection")
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ total: 0 }),
    );
    const user = userEvent.setup();
    renderWithListenProviders(<BandcampSection />, { locale: "en" });
    await screen.findByRole("alert");
    failed = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("Collection 0 · Wishlist 0 · Following 0"),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      mocks.api.mock.calls.filter(
        ([path]) => path === "/api/bandcamp/me/status",
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
  });
});
