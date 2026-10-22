import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import {
  afterAll,
  beforeAll,
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

import { Browse } from "./Browse";

const radixElementPolyfills = {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
};
const installedPolyfills: string[] = [];

beforeAll(() => {
  for (const [name, value] of Object.entries(radixElementPolyfills)) {
    if (!(name in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        value,
      });
      installedPolyfills.push(name);
    }
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }
});

afterAll(() => {
  for (const name of installedPolyfills) {
    Reflect.deleteProperty(HTMLElement.prototype, name);
  }
  vi.unstubAllGlobals();
});

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

    await userEvent.click(
      screen.getByRole("radio", { name: "Featured artists" }),
    );

    await waitFor(() => {
      expect(
        apiMock.mock.calls.some(([url]) =>
          String(url).includes("featured=true"),
        ),
      ).toBe(true);
    });
  });

  it("filters artists with open health issues", async () => {
    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <Browse />
      </MemoryRouter>,
    );

    await screen.findByText("Converge");
    await userEvent.click(
      screen.getByRole("radio", { name: "With open issues" }),
    );

    await waitFor(() => {
      expect(
        apiMock.mock.calls.some(([url]) =>
          String(url).includes("has_issues=true"),
        ),
      ).toBe(true);
    });
  });

  it("shows a retry state when the artist request fails instead of an empty catalog", async () => {
    let artistRequests = 0;
    apiMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/browse/filters")) {
        return Promise.resolve({
          genres: [],
          countries: [],
          decades: [],
          formats: [],
        });
      }
      artistRequests += 1;
      if (artistRequests === 1) return Promise.reject(new Error("offline"));
      return Promise.resolve({
        items: [
          {
            id: 7,
            name: "Converge",
            albums: 3,
            tracks: 20,
            total_size_mb: 100,
            has_photo: false,
            primary_format: "flac",
          },
        ],
        total: 1,
        page: 1,
        per_page: 60,
      });
    });

    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <Browse />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load artists. Try again.");
    expect(
      screen.queryByText("No artists in the library yet"),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Converge")).toBeVisible();
  });
});
