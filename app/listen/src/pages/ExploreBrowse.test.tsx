import { fireEvent, screen } from "@testing-library/react";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { Explore } from "./Explore";
vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
const ready = {
  playlists: [],
  moods: [],
  filters: { genres: [], decades: ["1990s"] },
};
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Location">
      {location.search}
      {location.hash}
    </output>
  );
}
function mount(route = "/explore") {
  return renderWithListenProviders(
    <>
      <Explore />
      <Location />
    </>,
    { route, path: "/explore" },
  );
}
describe("Explore browse contracts", () => {
  beforeEach(() => vi.mocked(useApi).mockReset());
  it("preserves unrelated query state and hash while opening a decade and returning", () => {
    vi.mocked(useApi).mockImplementation((url) => ({
      data:
        url === "/api/browse/explore-page" ? ready : { items: [], total: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    mount("/explore?keep=one&keep=two#browse");
    fireEvent.click(screen.getByRole("button", { name: "1990s" }));
    expect(screen.getByLabelText("Location")).toHaveTextContent(
      "?keep=one&keep=two&decade=1990s#browse",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Location")).toHaveTextContent(
      "?keep=one&keep=two#browse",
    );
  });
  it.each([
    "/explore",
    "/explore?decade=1990s",
    "/explore?playlistCategory=editorial",
    "/explore?genre=ambient",
  ])(
    "offers retry rather than empty/not-found on a failed read: %s",
    (route) => {
      const refetch = vi.fn();
      vi.mocked(useApi).mockReturnValue({
        data: null,
        loading: false,
        error: "gateway unavailable",
        status: 503,
        refetch,
      });
      mount(route);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByText("Genre not found")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps a real missing genre distinct from a retryable failure", () => {
    vi.mocked(useApi).mockReturnValue({
      data: null,
      loading: false,
      error: "not found",
      status: 404,
      refetch: vi.fn(),
    });
    mount("/explore?genre=missing&keep=one#browse");
    expect(screen.getByTestId("error-state")).toHaveAttribute(
      "data-kind",
      "notFound",
    );
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Location")).toHaveTextContent(
      "?keep=one#browse",
    );
  });
  it("keeps unrelated query state when opening a related genre", () => {
    vi.mocked(useApi).mockImplementation((url) => ({
      data:
        url === "/api/browse/explore-page"
          ? ready
          : {
              id: 1,
              name: "Ambient",
              slug: "ambient",
              artists: [],
              albums: [],
              related_genres: [
                {
                  slug: "drone",
                  page_slug: "drone-music",
                  name: "Drone",
                  relation_type: "related",
                  relation_label: "Related",
                  artist_count: 0,
                  album_count: 0,
                },
              ],
            },
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    mount("/explore?genre=ambient&keep=one&keep=two#browse");
    fireEvent.click(screen.getByRole("button", { name: /Drone/ }));
    expect(screen.getByLabelText("Location")).toHaveTextContent(
      "?keep=one&keep=two&genre=drone-music#browse",
    );
  });
  it("renders genre counts with the shared mono role, including zero", () => {
    vi.mocked(useApi).mockImplementation((url) => ({
      data:
        url === "/api/browse/explore-page"
          ? ready
          : {
              id: 1,
              name: "Ambient",
              slug: "ambient",
              artists: [],
              albums: [],
              artist_count: 0,
              album_count: 0,
              track_count: 0,
            },
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    mount("/explore?genre=ambient");
    expect(screen.getByText("0 artists")).toHaveClass(
      "font-mono",
      "uppercase",
      "font-normal",
    );
  });
  it("keeps cached landing content visible and offers retry after revalidation fails", () => {
    const refetch = vi.fn();
    vi.mocked(useApi).mockReturnValue({
      data: ready,
      loading: false,
      error: "offline",
      refetch,
    });
    mount();
    expect(screen.getByRole("button", { name: "1990s" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
