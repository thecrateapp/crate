import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { installRadixElementPolyfills } from "@/test/radix-element-polyfills";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { Playlists } from "./Playlists";

let smartMixAvailable = true;
let disposeRadix: () => void;
beforeAll(() => {
  disposeRadix = installRadixElementPolyfills();
});
afterAll(() => disposeRadix());

describe("Smart playlist creation track requirements", () => {
  beforeEach(() => {
    smartMixAvailable = true;
    apiMock.mockReset();
    apiMock.mockImplementation(async (url: string, method = "GET") => {
      if (url === "/api/capabilities")
        return { smart_mix: { available: smartMixAvailable } };
      if (url === "/api/playlists/filter-options")
        return { genres: ["ambient"], artists: [], formats: [], keys: [] };
      if (url === "/api/admin/system-playlists" && method === "POST")
        return { id: 99 };
      if (url === "/api/admin/system-playlists") return [];
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  async function fillSmartPlaylist() {
    const user = userEvent.setup();
    renderWithAdminProviders(<Playlists />, { route: "/playlists" });
    await screen.findByText("No playlists for this view yet");
    await user.click(screen.getByRole("button", { name: "New smart" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Full mix");
    await user.click(screen.getByRole("combobox", { name: "Select genre" }));
    await user.click(await screen.findByRole("option", { name: "ambient" }));
    return user;
  }

  it.each([false, true])(
    "submits the optional Full profile requirement only when enabled (%s)",
    async (enabled) => {
      const user = await fillSmartPlaylist();
      const control = await screen.findByRole("switch", {
        name: "Full Smart Mix profile only",
      });
      expect(control).not.toBeChecked();
      if (enabled) await user.click(control);

      await user.click(screen.getByRole("combobox", { name: "Match" }));
      await user.click(screen.getByRole("option", { name: "Any rule" }));
      await user.click(screen.getByRole("button", { name: "Create & open" }));

      await waitFor(() => {
        expect(apiMock).toHaveBeenCalledWith(
          "/api/admin/system-playlists",
          "POST",
          expect.objectContaining({
            generation_mode: "smart",
            smart_rules: {
              match: "any",
              rules: [{ field: "genre", op: "contains", value: "ambient" }],
              limit: 50,
              sort: "random",
              ...(enabled ? { require_full_mix_profile: true } : {}),
            },
          }),
        );
      });
    },
  );

  it("keeps creation available without a Smart Mix requirement on unsupported servers", async () => {
    smartMixAvailable = false;
    const user = await fillSmartPlaylist();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create & open" }));

    await waitFor(() => {
      const body = apiMock.mock.calls.find(
        ([url, method]) =>
          url === "/api/admin/system-playlists" && method === "POST",
      )?.[2];
      expect(body?.smart_rules).toEqual({
        match: "all",
        rules: [{ field: "genre", op: "contains", value: "ambient" }],
        limit: 50,
        sort: "random",
      });
    });
  });

  it("does not offer automatic track requirements for a static playlist", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<Playlists />, { route: "/playlists" });
    await screen.findByText("No playlists for this view yet");
    await user.click(screen.getByRole("button", { name: "New static" }));

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.some(([url]) => url === "/api/capabilities"),
    ).toBe(false);
  });

  it.each([
    { operator: ">=", op: "gte", expected: "2000", requireFull: false },
    {
      operator: "Between",
      op: "between",
      expected: ["2000", "2020"],
      requireFull: true,
    },
  ])(
    "keeps year values as four-digit text for $op rules",
    async ({ operator, op, expected, requireFull }) => {
      const user = await fillSmartPlaylist();
      await user.click(screen.getByRole("combobox", { name: "Field" }));
      await user.click(screen.getByRole("option", { name: "Year" }));
      await user.click(screen.getByRole("combobox", { name: "Operator" }));
      await user.click(screen.getByRole("option", { name: operator }));
      if (op === "between") {
        await user.type(
          screen.getByRole("spinbutton", { name: "Minimum" }),
          "2000",
        );
        await user.type(
          screen.getByRole("spinbutton", { name: "Maximum" }),
          "2020",
        );
      } else {
        await user.type(screen.getByRole("textbox", { name: "Value" }), "2000");
      }
      if (requireFull) {
        await user.click(
          await screen.findByRole("switch", {
            name: "Full Smart Mix profile only",
          }),
        );
      }
      await user.click(screen.getByRole("button", { name: "Create & open" }));

      await waitFor(() => {
        expect(apiMock).toHaveBeenCalledWith(
          "/api/admin/system-playlists",
          "POST",
          expect.objectContaining({
            smart_rules: expect.objectContaining({
              rules: [{ field: "year", op, value: expected }],
              ...(requireFull ? { require_full_mix_profile: true } : {}),
            }),
          }),
        );
      });
    },
  );
});
