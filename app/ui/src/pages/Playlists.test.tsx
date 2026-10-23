import { installRadixElementPolyfills } from "@/test/radix-element-polyfills";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
let playlistRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Playlists } from "./Playlists";

describe("Playlists smart rule composer", () => {
  beforeEach(() => {
    apiMock.mockReset();
    playlistRows = [];
    apiMock.mockImplementation((url: string, method?: string) => {
      if (url === "/api/playlists/filter-options") {
        return Promise.resolve({
          genres: ["screamo", "ambient"],
          formats: ["flac"],
          keys: [],
          artists: [],
        });
      }
      if (url === "/api/admin/system-playlists" && method === "POST") {
        return Promise.resolve({ id: 99 });
      }
      if (
        url === "/api/admin/system-playlists" &&
        (!method || method === "GET")
      ) {
        return Promise.resolve(playlistRows);
      }
      return Promise.resolve([]);
    });
  });

  it("associates the identity captions with their native fields", async () => {
    renderWithAdminProviders(<Playlists />, { route: "/playlists" });
    await screen.findByText("No playlists for this view yet");
    await userEvent.click(screen.getByRole("button", { name: "New smart" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    const caption = screen.getByText("Name", { exact: true });
    expect(caption.closest("label")).toHaveAttribute("for", name.id);
    await userEvent.click(caption);
    expect(name).toHaveFocus();
  });

  it.each([
    ["New static", "New static playlist"],
    ["New smart", "New smart playlist"],
  ])(
    "keeps the %s composer on the shared flat card surface",
    async (trigger, title) => {
      renderWithAdminProviders(<Playlists />, { route: "/playlists" });
      await screen.findByText("No playlists for this view yet");
      await userEvent.click(screen.getByRole("button", { name: trigger }));

      const heading = await screen.findByRole("heading", { name: title });
      const card = heading.closest('[data-slot="card"]');
      expect(card).not.toBeNull();
      expect(
        card?.className
          .split(/\s+/)
          .filter((className) => className.startsWith("shadow-")),
      ).toEqual([]);
    },
  );

  it("shows the playlist identity, cover and information chips in the list", async () => {
    playlistRows = [
      {
        id: 7,
        name: "Screamo After Hours",
        description: "A late-night sample playlist.",
        generation_mode: "smart",
        auto_refresh_enabled: true,
        is_curated: true,
        is_active: true,
        category: "mood",
        follower_count: 12,
        track_count: 48,
        total_duration: 7200,
        generation_status: "idle",
        last_generated_at: "2026-10-20T10:00:00Z",
      },
    ];
    renderWithAdminProviders(<Playlists />, { route: "/playlists" });

    const row = await screen.findByRole("listitem");
    expect(row).toHaveAttribute("data-slot", "hairline-row");
    const link = screen.getByRole("link", { name: "Open Screamo After Hours" });
    expect(link).toHaveAttribute("href", "/playlists/7");
    expect(link).toHaveClass("items-stretch", "py-0");
    expect(row).toHaveTextContent(/smart.*curated.*active.*auto-refresh/i);
    expect(row).toHaveTextContent("A late-night sample playlist.");
    expect(row).toHaveTextContent("48 tracks");
    expect(row).toHaveTextContent("2h 0m");
    expect(row).toHaveTextContent("12 followers");
    expect(row).toHaveTextContent(/generated/i);
    const artwork = link.querySelector('[data-slot="playlist-artwork"]');
    const content = link.querySelector('[data-slot="playlist-row-content"]');
    const information = link.querySelector(
      '[data-slot="playlist-row-information"]',
    );
    expect(artwork).toHaveClass(
      "size-28",
      "md:size-44",
      "shrink-0",
      "border-border-quiet",
      "bg-canvas-surface",
    );
    expect(artwork?.className).not.toContain("border-white");
    expect(content?.firstElementChild).toBe(artwork);
    expect(information?.parentElement).toBe(content);
    expect(information).toHaveTextContent("active");
  });

  it("paginates playlist rows and opens the next page", async () => {
    playlistRows = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      name: `Playlist ${index + 1}`,
      description: "A sample playlist.",
      generation_mode: "static",
      is_curated: true,
      is_active: true,
      follower_count: 0,
      track_count: 12,
      total_duration: 1800,
    }));
    renderWithAdminProviders(<Playlists />, { route: "/playlists" });

    expect(
      await screen.findByRole("link", { name: "Open Playlist 20" }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open Playlist 21" })).toBeNull();
    expect(
      screen.queryByText("Showing 21 of 21 playlists", { exact: true }),
    ).toBeNull();
    expect(screen.getByText("1–20 of 21 · page 1 of 2")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Next playlists page" }),
    );

    expect(
      await screen.findByRole("link", { name: "Open Playlist 21" }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open Playlist 1" })).toBeNull();
    expect(screen.getByText("21–21 of 21 · page 2 of 2")).toBeInTheDocument();
  });

  it("keeps operator select focus across keyboard choices and submits the current rule", async () => {
    renderWithAdminProviders(<Playlists />, { route: "/playlists" });
    await screen.findByText("No playlists for this view yet");
    await userEvent.click(screen.getByRole("button", { name: "New smart" }));
    const removeRule = screen.getByRole("button", { name: "Remove rule 1" });
    expect(removeRule).not.toHaveAttribute("title");
    await userEvent.type(
      screen.getByPlaceholderText("Playlist name"),
      "Keyboard mix",
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Select genre" }));
    fireEvent.click(await screen.findByRole("option", { name: "screamo" }));
    expect(
      screen.getByRole("combobox", { name: "Select genre" }),
    ).toHaveTextContent("screamo");
    const operator = screen.getByRole("combobox", { name: "Operator" });
    await userEvent.click(operator);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(operator).toHaveTextContent("Not contains");
    expect(operator).toHaveFocus();
    expect(
      screen.getByRole("combobox", { name: "Select genre" }),
    ).toHaveTextContent("Select genre");
    await userEvent.click(operator);
    await userEvent.keyboard("{Home}{Enter}");
    expect(operator).toHaveTextContent("Equals");
    expect(operator).toHaveFocus();

    fireEvent.click(screen.getByRole("combobox", { name: "Select genre" }));
    fireEvent.click(await screen.findByRole("option", { name: "ambient" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Create & open" }),
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/system-playlists",
        "POST",
        expect.objectContaining({
          name: "Keyboard mix",
          generation_mode: "smart",
          smart_rules: expect.objectContaining({
            rules: [{ field: "genre", op: "eq", value: "ambient" }],
          }),
        }),
      );
    });
  });
});

let disposeRadix: () => void;
beforeAll(() => {
  disposeRadix = installRadixElementPolyfills();
});
afterAll(() => disposeRadix());
