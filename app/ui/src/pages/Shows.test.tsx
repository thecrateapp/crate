import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { Shows } from "./Shows";
import { Upcoming } from "./Upcoming";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("react-leaflet", () => ({
  MapContainer: () => null,
  TileLayer: () => null,
  Marker: () => null,
  Popup: () => null,
  useMap: () => ({}),
}));
vi.mock("@/components/shows/ShowCard", () => ({
  ShowCard: ({ show }: { show: { name: string } }) => <div>{show.name}</div>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (url) => {
    if (url.includes("/cached")) return { events: [] };
    if (url.endsWith("/shows/7"))
      return {
        id: 7,
        artist_name: "External Band",
        date: "2027-03-02",
        venue: "Hall",
        city: "City",
        latitude: null,
        longitude: null,
      };
    if (url === "/api/upcoming") return { items: [] };
    throw new Error(url);
  });
});
it("opens the manual editor in Shows and displays a new canonical show without coordinates", async () => {
  renderWithAdminProviders(<Shows />, { route: "/shows?show_id=7" });
  expect((await screen.findAllByText("External Band")).length).toBeGreaterThan(
    0,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add show" }));
  expect(screen.getByRole("dialog", { name: "Add show" })).toBeInTheDocument();
  expect(screen.getByLabelText("Time")).toHaveValue("");
});
it("opens the same manual editor from Upcoming and gates both entry points", async () => {
  const { unmount } = renderWithAdminProviders(<Upcoming />);
  await userEvent.click(screen.getByRole("button", { name: "Add show" }));
  expect(screen.getByRole("dialog", { name: "Add show" })).toBeInTheDocument();
  unmount();
  const denied = renderWithAdminProviders(<Upcoming />, {
    auth: { hasCapability: () => false, isAdmin: false },
  });
  expect(
    screen.queryByRole("button", { name: "Add show" }),
  ).not.toBeInTheDocument();
  denied.unmount();
  renderWithAdminProviders(<Shows />, { auth: { hasCapability: () => false } });
  expect(
    screen.queryByRole("button", { name: "Add show" }),
  ).not.toBeInTheDocument();
});
