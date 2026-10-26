import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { Upcoming } from "./Upcoming";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockImplementation(async (path, method) => {
    if (path === "/api/shows/cached?limit=5000") {
      return {
        events: [
          {
            id: "7",
            show_id: 7,
            artist_name: "Costa Norte",
            artist_id: 23,
            artist_slug: "costa-norte",
            date: "2099-05-15",
            venue: "Sala Norte",
            city: "Madrid",
            country: "Spain",
            image_url: null,
            url: "https://tickets.example/shows/7",
            lineup: ["Costa Norte"],
            lineup_artists: [
              {
                name: "Costa Norte",
                id: 23,
                slug: "costa-norte",
                probable_setlist_status: "fresh",
                probable_setlist_song_count: 10,
              },
            ],
            artist_genres: ["alternative rock"],
          },
        ],
        setlist_coverage: {
          artist_count: 1,
          fresh: 0,
          stale: 1,
          missing: 0,
          unknown: 0,
        },
      };
    }
    if (path === "/api/tasks/sync-shows" && method === "POST")
      return { task_id: "sync-shows" };
    if (path === "/api/shows/probable-setlists/refresh" && method === "POST")
      return { artist_count: 1, fresh: 1, stale: 0, missing: 0, unknown: 0 };
    return {};
  });
});

describe("Show Management visual contract", () => {
  it("uses the shared header actions and does not decorate text actions with icons", async () => {
    const user = userEvent.setup();
    const { container } = renderWithAdminProviders(<Upcoming />);
    await screen.findByRole("heading", { name: "Show Management" });
    const actions = screen.getByRole("group", {
      name: "Show management actions",
    });

    for (const label of ["List view", "Calendar view", "Sync shows"]) {
      const action = within(actions).getByRole("button", { name: label });
      expect(action).toHaveAttribute("data-size", "icon-lg");
      expect(action).toHaveAttribute("data-variant", "ghost");
      expect(action).not.toHaveAttribute("title");
      expect(action.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }

    for (const label of ["Add show", "Merge duplicates"]) {
      const action = within(actions).getByRole("button", { name: label });
      expect(action).toHaveAttribute("data-size", "icon-lg");
      expect(action).toHaveAttribute("data-variant", "ghost");
      expect(action).not.toHaveAttribute("title");
      expect(action.textContent).toBe("");
      expect(action.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(action.querySelector("svg")).toHaveAttribute(
        "data-admin-ux",
        label === "Add show" ? "show-add" : "show-merge",
      );
    }

    await user.click(screen.getByRole("button", { name: /Costa Norte/ }));
    const mergeRowAction = await screen.findByRole("button", {
      name: "Merge duplicates of this show",
    });
    expect(mergeRowAction).toHaveTextContent("Merge duplicates");
    expect(mergeRowAction.querySelector("svg")).toBeNull();

    for (const icon of container.querySelectorAll("svg")) {
      if (
        !icon.hasAttribute("data-admin-ux") &&
        !icon.closest('[data-slot="search-input"]')
      ) {
        expect(icon.closest("button, a, [role=combobox]")).toBeInTheDocument();
      }
    }
  });
});
