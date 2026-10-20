import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { Upcoming } from "./Upcoming";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function show(id: number, artist: string, date: string, venue: string) {
  return {
    type: "show",
    show_id: id,
    date,
    artist,
    title: venue,
    subtitle: "Madrid, Spain",
    cover_url: null,
    status: "onsale",
    venue,
    city: "Madrid",
    country: "Spain",
    is_upcoming: true,
  };
}

const ITEMS = [
  show(7, "Band", "2099-05-15", "Sala Norte"),
  show(8, " band ", "2099-05-15", "Sala Norte "),
  show(9, "Band", "2099-05-16", "Sala Sur"),
  show(10, "Other Act", "2099-05-15", "Sala Norte"),
];

const ROWS = [8, 7].map((id) => ({
  id,
  revision: 1,
  artist_name: "Band",
  date: "2099-05-15",
  venue: "Sala Norte",
  city: "Madrid",
  attendance_count: 0,
  reminder_count: 0,
}));

const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.mocked(api).mockImplementation(async (url: string) => {
    if (url === "/api/upcoming") return { items: ITEMS };
    if (url.startsWith("/api/show-imports/shows?")) return { items: ROWS };
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Location">{location.search}</output>;
}

function card(showId: number) {
  const element = document.getElementById(`upcoming-show-${showId}`);
  if (!element) throw new Error(`Show ${showId} is not listed`);
  return element;
}

it("opens a linked show's detail, scrolls to it and drops the link", async () => {
  renderWithAdminProviders(
    <>
      <Upcoming />
      <LocationProbe />
    </>,
    { route: "/upcoming?show_id=9" },
  );
  const detail = await waitFor(() =>
    within(card(9)).getByRole("button", { name: "Close show details" }),
  );
  expect(detail).toBeVisible();
  expect(
    within(card(7)).queryByRole("button", { name: "Close show details" }),
  ).toBeNull();
  expect(scrollIntoView).toHaveBeenCalledOnce();
  expect(scrollIntoView.mock.contexts[0]).toBe(card(9));
  // The router applies the replace as a transition.
  await waitFor(() =>
    expect(screen.getByLabelText("Location").textContent).toBe(""),
  );
  expect(
    screen.queryByText("That show isn't in the upcoming list."),
  ).toBeNull();
});

it("says so when the linked show isn't in the upcoming list", async () => {
  renderWithAdminProviders(
    <>
      <Upcoming />
      <LocationProbe />
    </>,
    { route: "/upcoming?show_id=99" },
  );
  expect(
    await screen.findByText("That show isn't in the upcoming list."),
  ).toHaveAttribute("role", "status");
  // The router applies the replace as a transition.
  await waitFor(() =>
    expect(screen.getByLabelText("Location").textContent).toBe(""),
  );
  expect(screen.queryByRole("button", { name: "Close show details" })).toBe(
    null,
  );
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it("merges from a show's detail with its look-alikes already loaded", async () => {
  renderWithAdminProviders(<Upcoming />, { route: "/upcoming?show_id=8" });
  const detail = await waitFor(() => card(8));
  const user = userEvent.setup();
  await user.click(
    await within(detail).findByRole("button", { name: "Merge duplicates" }),
  );
  const panel = await screen.findByRole("dialog", {
    name: "Merge duplicate shows",
  });
  // This show first, then the same artist on the same date; not show 9
  // (another date) nor show 10 (another artist).
  expect(within(panel).getByLabelText("Show IDs")).toHaveValue("8, 7");
  expect(
    await within(panel).findByRole("radio", { name: "Keep show 8" }),
  ).toBeChecked();
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(([url]) => url.startsWith("/api/show-imports/shows?"))
      .map(([url]) => url),
  ).toEqual(["/api/show-imports/shows?ids=8&ids=7"]);
  expect(
    vi.mocked(api).mock.calls.filter(([, method]) => method === "POST"),
  ).toHaveLength(0);
  expect(
    within(panel).queryByRole("button", { name: "Merge shows" }),
  ).toBeNull();
});

it("still opens an empty merge editor from the toolbar", async () => {
  renderWithAdminProviders(<Upcoming />);
  await waitFor(() => card(7));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Merge duplicates" }));
  const panel = await screen.findByRole("dialog", {
    name: "Merge duplicate shows",
  });
  expect(within(panel).getByLabelText("Show IDs")).toHaveValue("");
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(([url]) => url.startsWith("/api/show-imports/shows?")),
  ).toHaveLength(0);
});

it("offers the detail merge only to show curators", async () => {
  renderWithAdminProviders(<Upcoming />, {
    route: "/upcoming?show_id=7",
    auth: {
      hasCapability: (capability: string) =>
        capability !== "curation.shows.write",
    },
  });
  await waitFor(() =>
    within(card(7)).getByRole("button", { name: "Close show details" }),
  );
  expect(screen.queryByRole("button", { name: "Merge duplicates" })).toBe(null);
});
