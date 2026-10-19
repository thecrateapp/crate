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

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Playlists } from "./Playlists";

describe("Playlists smart rule composer", () => {
  beforeEach(() => {
    apiMock.mockReset();
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
      return Promise.resolve([]);
    });
  });

  it("keeps operator select focus across keyboard choices and submits the current rule", async () => {
    renderWithAdminProviders(<Playlists />, { route: "/playlists" });
    await screen.findByText("No playlists for this view yet");
    await userEvent.click(screen.getByRole("button", { name: "New smart" }));
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
