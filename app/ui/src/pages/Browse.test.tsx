import { act, render, screen, waitFor } from "@testing-library/react";
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

const { apiMock, capabilities } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  capabilities: new Set<string>(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    hasCapability: (value: string) => capabilities.has(value),
  }),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { Browse } from "./Browse";
import { toast } from "sonner";

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
    capabilities.clear();
    [
      "library.metadata.write",
      "library.analysis.manage",
      "library.artist.remove",
      "library.files.delete",
    ].forEach((value) => capabilities.add(value));
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
  it("preserves square artist covers in both Browse layouts", async () => {
    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <Browse />
      </MemoryRouter>,
    );
    const image = await screen.findByRole("img", { name: "Converge" });
    const artwork = image.closest("[data-slot=entity-artwork]");
    expect(image.closest("[data-slot=entity-card]")).toHaveAttribute(
      "data-shape",
      "square",
    );
    expect(artwork).toHaveClass("aspect-square", "rounded-lg");
    expect(artwork).not.toHaveClass("rounded-full");
    await userEvent.click(screen.getByRole("button", { name: "List view" }));
    const rowImage = screen.getByRole("img", { name: "Converge" });
    expect(rowImage.parentElement).toHaveAttribute("data-shape", "square");
    expect(rowImage.parentElement).toHaveClass("rounded-lg");
    expect(rowImage.parentElement).not.toHaveClass("rounded-full");
  });
  it("uses named shared view actions and a text-only selection toggle", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <Browse />
      </MemoryRouter>,
    );
    await screen.findByText("Converge");
    const grid = screen.getByRole("button", { name: "Grid view" });
    const list = screen.getByRole("button", { name: "List view" });
    expect(grid).toHaveAttribute("data-size", "icon-lg");
    expect(grid).toHaveAttribute("aria-pressed", "true");
    expect(list).not.toHaveAttribute("title");
    await user.click(list);
    expect(list).toHaveAttribute("aria-pressed", "true");
    const select = screen.getByRole("button", { name: "Select" });
    expect(select.querySelector("svg")).toBeNull();
    await user.click(select);
    expect(
      screen.getByRole("button", { name: "Done" }).querySelector("svg"),
    ).toBeNull();
  });

  it("does not replace current filtered results with an obsolete request", async () => {
    let resolveOld!: (value: unknown) => void;
    apiMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/browse/filters"))
        return Promise.resolve({
          genres: [],
          countries: [],
          decades: [],
          formats: [],
        });
      if (!url.includes("featured=true"))
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return Promise.resolve({
        items: [
          {
            id: 9,
            name: "Current artist",
            albums: 1,
            tracks: 2,
            total_size_mb: 5,
          },
        ],
        total: 1,
      });
    });
    render(
      <MemoryRouter>
        <Browse />
      </MemoryRouter>,
    );
    await userEvent.click(
      screen.getByRole("radio", { name: "Featured artists" }),
    );
    await screen.findByText("Current artist");
    await act(async () => {
      resolveOld({
        items: [
          {
            id: 7,
            name: "Obsolete artist",
            albums: 1,
            tracks: 2,
            total_size_mb: 5,
          },
        ],
        total: 99,
      });
    });
    await waitFor(() =>
      expect(screen.queryByText("Obsolete artist")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Current artist")).toBeVisible();
  });
  it("keeps failed batch selections available for retry and reports the actual result", async () => {
    render(
      <MemoryRouter>
        <Browse />
      </MemoryRouter>,
    );
    await screen.findByText("Converge");
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Select Converge" }),
    );
    apiMock.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: /^Enrich/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Deselect Converge" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Enrich/ })).toBeEnabled();
  });
  it("hides bulk writes without their capabilities", async () => {
    capabilities.clear();
    render(
      <MemoryRouter>
        <Browse />
      </MemoryRouter>,
    );
    await screen.findByText("Converge");
    expect(
      screen.queryByRole("button", { name: "Select" }),
    ).not.toBeInTheDocument();
  });
});
