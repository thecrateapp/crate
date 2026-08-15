import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { Browse } from "./Browse";

describe("Browse featured artists", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/browse/filters")) {
        return Promise.resolve({
          genres: [],
          countries: [],
          decades: [],
          formats: [],
        });
      }
      return Promise.resolve({
        items: [
          {
            id: 7,
            name: "Converge",
            albums: 3,
            tracks: 20,
            total_size_mb: 100,
            has_photo: true,
            primary_format: "flac",
            is_featured: true,
            featured_devices: ["desktop"],
          },
        ],
        total: 1,
        page: 1,
        per_page: 60,
      });
    });
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    });
  });

  it("uses Recently Added by default and filters by Featured", async () => {
    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <Browse />
      </MemoryRouter>,
    );

    await screen.findByText("Converge");
    const firstArtistsRequest = apiMock.mock.calls.find(([url]) =>
      String(url).startsWith("/api/artists?"),
    )?.[0] as string;
    expect(firstArtistsRequest).toContain("sort=recent");
    expect(firstArtistsRequest).not.toContain("featured=");

    await userEvent.click(screen.getByRole("button", { name: "Featured" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Featured artists" }),
    );

    await waitFor(() => {
      expect(
        apiMock.mock.calls.some(([url]) =>
          String(url).includes("featured=true"),
        ),
      ).toBe(true);
    });
  });
});
