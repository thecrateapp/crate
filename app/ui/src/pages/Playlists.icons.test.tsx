import { installRadixElementPolyfills } from "@/test/radix-element-polyfills";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import fixture from "../../../../tests/admin-e2e/fixtures/playlists-1ap.json";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Playlists } from "./Playlists";
const mock = vi.mocked(api);
function Location() {
  return <output data-testid="destination">{useLocation().pathname}</output>;
}
function mount() {
  return renderWithAdminProviders(
    <>
      <Playlists />
      <Location />
    </>,
    { route: "/playlists" },
  );
}
describe("System Playlists reviewed rendering and contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.mockImplementation(async (path, method = "GET", body) => {
      if (path === "/api/admin/system-playlists" && method === "GET")
        return structuredClone(fixture.items);
      if (path === "/api/playlists/filter-options")
        return structuredClone(fixture.filterOptions);
      if (path === "/api/admin/system-playlists" && method === "POST")
        return { ...fixture.items[0], ...(body as object), id: 99 };
      return {};
    });
  });
  it.each([false, true])(
    "uses form selects for category and smart match/sort (smart=%s)",
    async (smart) => {
      const user = userEvent.setup();
      mount();
      await screen.findByRole("heading", { name: "Costa de noche" });
      await user.click(
        screen.getByRole("button", {
          name: smart ? "New smart" : "New static",
        }),
      );
      await user.click(screen.getByRole("combobox", { name: "Category" }));
      await user.click(screen.getByRole("option", { name: "Genre" }));
      await user.type(
        screen.getByRole("textbox", { name: "Name" }),
        "Nueva selección",
      );
      if (smart) {
        for (const [name, option] of [
          ["Match", "Any rule"],
          ["Sort", "Popularity"],
          ["Select genre", "Ambient"],
        ]) {
          await user.click(screen.getByRole("combobox", { name }));
          await user.click(screen.getByRole("option", { name: option }));
        }
        const remove = screen.getByRole("button", { name: "Remove rule 1" });
        expect(remove.textContent).toBe("");
        expect(
          remove.querySelector('svg[data-admin-ux="playlists-remove-rule"]'),
        ).not.toBeNull();
      }
      await user.click(screen.getByRole("button", { name: "Create & open" }));
      await waitFor(() =>
        expect(mock).toHaveBeenCalledWith(
          "/api/admin/system-playlists",
          "POST",
          expect.objectContaining({
            category: "genre",
            ...(smart
              ? {
                  smart_rules: expect.objectContaining({
                    match: "any",
                    sort: "popularity",
                  }),
                }
              : {}),
          }),
        ),
      );
    },
  );

  it("uses a bounded operator select and keeps numeric range creation", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Costa de noche" });
    await user.click(screen.getByRole("button", { name: "New smart" }));
    expect(
      screen.queryByRole("radiogroup", { name: "Operator" }),
    ).not.toBeInTheDocument();
    const operator = screen.getByRole("combobox", { name: "Operator" });
    expect(operator).toHaveTextContent("Contains");
    await user.click(screen.getByRole("combobox", { name: "Field" }));
    await user.click(screen.getByRole("option", { name: "BPM" }));
    expect(operator).toHaveTextContent("=");
    await user.click(operator);
    expect(
      screen.queryByRole("option", { name: "Operator" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Between" }));
    await user.type(screen.getByRole("spinbutton", { name: "Minimum" }), "90");
    await user.type(screen.getByRole("spinbutton", { name: "Maximum" }), "120");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Tempo");
    await user.click(screen.getByRole("button", { name: "Create & open" }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/admin/system-playlists",
        "POST",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            rules: [{ field: "bpm", op: "between", value: [90, 120] }],
          }),
        }),
      ),
    );
  });
  it("uses display headings, named row actions and only reviewed functional glyphs", async () => {
    const { container } = mount();
    await screen.findByRole("heading", { name: "Costa de noche" });
    expect(
      screen.getByRole("heading", { name: "System Playlists" }),
    ).toHaveClass("crate-page-title");
    for (const name of [
      "Edit Costa de noche",
      "Deactivate Costa de noche",
      "Activate Archivo pausado",
      "Delete Costa de noche",
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("data-size", "icon-lg");
      expect(button).toHaveAttribute("data-variant", "ghost");
      expect(button).not.toHaveAttribute("title");
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
    expect(
      container.querySelectorAll(".playlist-artwork-placeholder svg"),
    ).toHaveLength(0);
    const search = screen.getByRole("searchbox", { name: "Search playlists" });
    expect(search.closest(".crate-form-field")).toBeInTheDocument();
  });
  it("opens the correct editor from the row toolbar by keyboard without triggering its parent", async () => {
    const user = userEvent.setup();
    mount();
    const open = await screen.findByRole("button", {
      name: "Edit Archivo pausado",
    });
    open.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("destination")).toHaveTextContent(
      "/playlists/13",
    );
  });
  it("preserves search, category and mode filtering/counts plus keyboard editor navigation", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Costa de noche" });
    await user.type(
      screen.getByRole("searchbox", { name: "Search playlists" }),
      "Archivo",
    );
    expect(
      screen.queryByRole("heading", { name: "Costa de noche" }),
    ).not.toBeInTheDocument();
    await user.clear(
      screen.getByRole("searchbox", { name: "Search playlists" }),
    );
    await user.click(screen.getByRole("button", { name: /Inactive1/ }));
    expect(
      screen.getByRole("heading", { name: "Archivo pausado" }),
    ).toBeInTheDocument();
    const row = screen.getByRole("link", { name: /Archivo pausado/ });
    row.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("destination")).toHaveTextContent(
      "/playlists/13",
    );
  });
  it("keeps activate/deactivate and confirmation/delete endpoints and feedback", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Costa de noche" });
    await user.click(
      screen.getByRole("button", { name: "Deactivate Costa de noche" }),
    );
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/admin/system-playlists/11/deactivate",
        "POST",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete Costa de noche" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Costa de noche");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/admin/system-playlists/11",
        "DELETE",
      ),
    );
    expect(toast.success).toHaveBeenCalledWith('Deleted "Costa de noche"');
  });
  it("retains static create defaults, trimmed payload, pending name and destination", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Costa de noche" });
    await user.click(screen.getByRole("button", { name: "New static" }));
    await user.type(
      screen.getByRole("textbox", { name: "Name" }),
      "  Puerto  ",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "  Noche  ",
    );
    let finish!: (value: unknown) => void;
    mock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Create & open" }));
    expect(
      screen.getByRole("button", { name: "Create & open" }),
    ).toBeDisabled();
    expect(mock).toHaveBeenLastCalledWith(
      "/api/admin/system-playlists",
      "POST",
      {
        name: "Puerto",
        description: "Noche",
        category: "editorial",
        featured_rank: null,
        generation_mode: "static",
        is_curated: true,
        is_active: true,
      },
    );
    await act(async () => finish({ ...fixture.items[0], id: 99 }));
    expect(screen.getByTestId("destination")).toHaveTextContent(
      "/playlists/99",
    );
  });
  it("keeps smart empty-rule validation, row removal safeguards and existing payload defaults", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Costa de noche" });
    await user.click(screen.getByRole("button", { name: "New smart" }));
    await user.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Ambient mix",
    );
    await user.click(screen.getByRole("button", { name: "Create & open" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add at least one smart rule.",
    );
    expect(mock.mock.calls.some(([, method]) => method === "POST")).toBe(false);
    expect(
      screen.getByRole("button", { name: "Remove rule 1" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add rule" }));
    await user.click(screen.getByRole("button", { name: "Remove rule 2" }));
    await user.click(screen.getByRole("combobox", { name: "Select genre" }));
    await user.click(await screen.findByRole("option", { name: "Ambient" }));
    await user.click(screen.getByRole("button", { name: "Create & open" }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/admin/system-playlists",
        "POST",
        expect.objectContaining({
          generation_mode: "smart",
          auto_refresh_enabled: true,
          smart_rules: {
            match: "all",
            rules: [{ field: "genre", op: "contains", value: "Ambient" }],
            limit: 50,
            sort: "random",
          },
        }),
      ),
    );
  });
  it("retains named loading and existing empty/error behavior without illustrations", async () => {
    let finish!: (value: unknown) => void;
    mock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const { container } = mount();
    expect(
      screen.getByRole("status", { name: "Loading playlists" }),
    ).toBeInTheDocument();
    await act(async () => finish([]));
    expect(
      screen.getByRole("heading", { name: "No playlists for this view yet" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(4); // Search, category disclosure and two compact creation actions.
  });
});

let disposeRadix: () => void;
beforeAll(() => {
  disposeRadix = installRadixElementPolyfills();
});
afterAll(() => disposeRadix());
