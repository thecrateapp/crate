import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Playlists } from "./Playlists";

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/api/admin/system-playlists") return [];
    if (path === "/api/playlists/filter-options")
      return { genres: [], formats: [], keys: [], artists: [] };
    throw new Error(`Unexpected playlist header request: ${path}`);
  });
});
afterEach(cleanup);

describe("System Playlists page header", () => {
  it("uses the canonical hero and shared header action geometry", async () => {
    renderWithAdminProviders(<Playlists />, { route: "/playlists" });

    expect(
      await screen.findByRole("heading", { name: "System Playlists" }),
    ).toHaveClass("font-display", "font-extrabold");
    const actions = screen.getByRole("group", { name: "Page actions" });
    for (const name of ["New static", "New smart"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("data-size", "icon-lg");
      expect(button).toHaveAttribute("data-variant", "ghost");
      expect(button).not.toHaveAttribute("title");
      expect(actions).toContainElement(button);
    }
  });
});
