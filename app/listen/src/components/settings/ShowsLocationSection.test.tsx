import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@crate/ui/lib/notify", () => ({
  notify: { success: mocks.success, error: mocks.error },
}));
import { ShowsLocationSection } from "./ShowsLocationSection";
const madrid = {
  city: "Madrid",
  country: "Spain",
  country_code: "ES",
  latitude: 40.4,
  longitude: -3.7,
  show_radius_km: 60,
  show_location_mode: "fixed",
};
describe("Shows settings reads", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
  });
  it("keeps unknown defaults unavailable after a failed read, retries without writing and then persists a chosen radius", async () => {
    mocks.api
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(madrid)
      .mockResolvedValue({});
    const user = userEvent.setup();
    renderWithListenProviders(<ShowsLocationSection />, { locale: "en" });
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("combobox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    const radius = await screen.findByRole("combobox", {
      name: "Search radius",
    });
    expect(mocks.api.mock.calls).toEqual([
      ["/api/me/location"],
      ["/api/me/location"],
    ]);
    await user.click(radius);
    await user.click(screen.getByRole("option", { name: "100 km" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith("/api/me/location", "PUT", {
        show_radius_km: 100,
      }),
    );
  });
  it.each([true, false])(
    "announces explicit IP detection success=%s",
    async (success) => {
      mocks.api.mockResolvedValueOnce(madrid);
      if (success)
        mocks.api.mockResolvedValueOnce(madrid).mockResolvedValueOnce({});
      else mocks.api.mockRejectedValueOnce(new Error("network"));
      const user = userEvent.setup();
      renderWithListenProviders(<ShowsLocationSection />, { locale: "en" });
      await screen.findByRole("combobox", { name: "City" });
      await user.click(screen.getByRole("button", { name: "Detect from IP" }));
      if (success)
        await waitFor(() =>
          expect(mocks.success).toHaveBeenCalledWith("Detected: Madrid, Spain"),
        );
      else
        await waitFor(() =>
          expect(mocks.error).toHaveBeenCalledWith(
            "Could not detect your location",
          ),
        );
    },
  );

  it("ignores a slower previous city query and keeps late results closed after Escape or blur", async () => {
    const manchester = {
      city: "Manchester",
      country: "United Kingdom",
      country_code: "GB",
      display_name: "Manchester, United Kingdom",
      latitude: 53.4,
      longitude: -2.2,
    };
    const madridResult = { ...madrid, display_name: "Madrid, Spain" };
    let resolveOld!: (items: unknown[]) => void,
      resolveNew!: (items: unknown[]) => void,
      resolveLate!: (items: unknown[]) => void;
    const oldReply = new Promise((resolve) => {
        resolveOld = resolve;
      }),
      newReply = new Promise((resolve) => {
        resolveNew = resolve;
      }),
      lateReply = new Promise((resolve) => {
        resolveLate = resolve;
      });
    mocks.api.mockImplementation((path: string) =>
      path === "/api/me/location"
        ? Promise.resolve(madrid)
        : path.endsWith("q=Ma")
          ? oldReply
          : path.endsWith("q=Man")
            ? newReply
            : lateReply,
    );
    const user = userEvent.setup();
    renderWithListenProviders(<ShowsLocationSection />, { locale: "en" });
    const city = await screen.findByRole("combobox", { name: "City" });
    await user.clear(city);
    await user.type(city, "Ma");
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/me/cities/search?q=Ma"),
    );
    await user.type(city, "n");
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/me/cities/search?q=Man"),
    );
    await act(async () => resolveNew([manchester]));
    expect(
      await screen.findByRole("option", { name: "Manchester, United Kingdom" }),
    ).toBeVisible();
    await act(async () => resolveOld([madridResult]));
    expect(screen.queryByRole("option", { name: "Madrid, Spain" })).toBeNull();
    await user.clear(city);
    await user.type(city, "Mar");
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/me/cities/search?q=Mar"),
    );
    await user.keyboard("{Escape}");
    await act(async () => resolveLate([madridResult]));
    expect(screen.queryByRole("option")).toBeNull();
    await user.tab();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it.each(["blur", "clear", "select"])(
    "does not reopen city suggestions after %s",
    async (scenario) => {
      const manchester = {
        city: "Manchester",
        country: "United Kingdom",
        country_code: "GB",
        display_name: "Manchester, United Kingdom",
        latitude: 53.4,
        longitude: -2.2,
      };
      let resolveLate!: (value: unknown[]) => void;
      const lateReply = new Promise((resolve) => {
        resolveLate = resolve;
      });
      mocks.api.mockImplementation((path: string) =>
        path === "/api/me/location"
          ? Promise.resolve(madrid)
          : path.endsWith("q=Ma")
            ? lateReply
            : path.endsWith("q=Man")
              ? Promise.resolve([manchester])
              : Promise.resolve({}),
      );
      const user = userEvent.setup();
      renderWithListenProviders(<ShowsLocationSection />, { locale: "en" });
      const city = await screen.findByRole("combobox", { name: "City" });
      await user.clear(city);
      await user.type(city, "Ma");
      await waitFor(() =>
        expect(mocks.api).toHaveBeenCalledWith("/api/me/cities/search?q=Ma"),
      );
      if (scenario === "blur") await user.tab();
      else if (scenario === "clear") await user.clear(city);
      else {
        await user.type(city, "n");
        await user.click(
          await screen.findByRole("option", {
            name: "Manchester, United Kingdom",
          }),
        );
      }
      await act(async () =>
        resolveLate([{ ...madrid, display_name: "Madrid, Spain" }]),
      );
      expect(screen.queryByRole("listbox")).toBeNull();
      if (scenario === "select") expect(city).toHaveValue("Manchester");
    },
  );
});
