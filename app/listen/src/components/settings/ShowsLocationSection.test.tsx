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

  it.each(["radius", "mode"] as const)(
    "keeps the confirmed %s during a pending write, blocks concurrent changes and retains it on rejection",
    async (field) => {
      let rejectWrite!: (error: Error) => void;
      const pendingWrite = new Promise((_, reject) => {
        rejectWrite = reject;
      });
      mocks.api
        .mockResolvedValueOnce(madrid)
        .mockReturnValueOnce(pendingWrite)
        .mockResolvedValue({});
      const user = userEvent.setup();
      renderWithListenProviders(<ShowsLocationSection />, { locale: "en" });
      const mode = await screen.findByRole("combobox", {
        name: "Location for shows",
      });
      const radius = screen.getByRole("combobox", { name: "Search radius" });
      await user.click(field === "radius" ? radius : mode);
      await user.click(
        screen.getByRole("option", {
          name: field === "radius" ? "100 km" : "Near me",
        }),
      );
      expect(radius).toHaveTextContent("60 km");
      expect(mode).toHaveTextContent("Fixed city");
      expect(radius).toBeDisabled();
      expect(mode).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "City" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Detect from IP" }),
      ).toBeDisabled();
      await user.click(radius);
      expect(
        mocks.api.mock.calls.filter((call) => call[1] === "PUT"),
      ).toHaveLength(1);
      await act(async () => rejectWrite(new Error("rejected")));
      expect(radius).toHaveTextContent("60 km");
      expect(mode).toHaveTextContent("Fixed city");
      expect(radius).toBeEnabled();
      expect(mode).toBeEnabled();
      await user.click(field === "radius" ? radius : mode);
      await user.click(
        screen.getByRole("option", {
          name: field === "radius" ? "100 km" : "Near me",
        }),
      );
      await waitFor(() =>
        expect(field === "radius" ? radius : mode).toHaveTextContent(
          field === "radius" ? "100 km" : "Near me",
        ),
      );
    },
  );

  it("keeps the confirmed city until a city write succeeds and can retry after rejection", async () => {
    const manchester = {
      city: "Manchester",
      country: "United Kingdom",
      country_code: "GB",
      display_name: "Manchester, United Kingdom",
      latitude: 53.4,
      longitude: -2.2,
    };
    let rejectWrite!: (error: Error) => void;
    const pendingWrite = new Promise((_, reject) => {
      rejectWrite = reject;
    });
    let attempts = 0;
    mocks.api.mockImplementation((path: string, method?: string) =>
      method === "PUT"
        ? ++attempts === 1
          ? pendingWrite
          : Promise.resolve({})
        : path === "/api/me/location"
          ? Promise.resolve(madrid)
          : Promise.resolve([manchester]),
    );
    const user = userEvent.setup();
    renderWithListenProviders(<ShowsLocationSection />, { locale: "en" });
    const city = await screen.findByRole("combobox", { name: "City" });
    const selectManchester = async () => {
      await user.clear(city);
      await user.type(city, "Man");
      await user.click(
        await screen.findByRole("option", {
          name: "Manchester, United Kingdom",
        }),
      );
    };
    await selectManchester();
    expect(city).toHaveValue("Madrid");
    expect(city).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Search radius" }),
    ).toBeDisabled();
    await act(async () => rejectWrite(new Error("rejected")));
    expect(city).toHaveValue("Madrid");
    expect(city).toBeEnabled();
    await selectManchester();
    await waitFor(() => expect(city).toHaveValue("Manchester"));
  });

  it("serializes IP detection with the other location changes and retains the confirmed city if its PUT fails", async () => {
    const detected = {
      city: "Paris",
      country: "France",
      country_code: "FR",
      latitude: 48.8,
      longitude: 2.3,
    };
    let rejectWrite!: (error: Error) => void;
    const pendingWrite = new Promise((_, reject) => {
      rejectWrite = reject;
    });
    mocks.api
      .mockResolvedValueOnce(madrid)
      .mockResolvedValueOnce(detected)
      .mockReturnValueOnce(pendingWrite);
    const user = userEvent.setup();
    renderWithListenProviders(<ShowsLocationSection />, { locale: "en" });
    const city = await screen.findByRole("combobox", { name: "City" });
    await user.click(screen.getByRole("button", { name: "Detect from IP" }));
    expect(city).toHaveValue("Madrid");
    expect(city).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Location for shows" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Search radius" }),
    ).toBeDisabled();
    await act(async () => rejectWrite(new Error("rejected")));
    expect(city).toHaveValue("Madrid");
    expect(city).toBeEnabled();
    expect(screen.getByText("Madrid, Spain")).toBeVisible();
    expect(mocks.error).toHaveBeenCalledWith("Could not detect your location");
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
