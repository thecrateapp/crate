import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
}));

const { genreRefetchMock, taxonomyRefetchMock } = vi.hoisted(() => ({
  genreRefetchMock: vi.fn(),
  taxonomyRefetchMock: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    hasCapability: (capability: string) =>
      capability === "curation.genres.write",
  }),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: apiMock,
}));

vi.mock("@/components/genres/GenreNetworkGraph", () => ({
  GenreNetworkGraph: () => <div data-testid="genre-network" />,
}));

vi.mock("@/components/genres/GenreEqEditor", () => ({
  GenreEqEditor: () => <div data-testid="genre-eq" />,
}));

vi.mock("@/components/ImageCropUpload", () => ({
  ImageCropUpload: ({
    endpoint,
    aspect,
    onUploaded,
  }: {
    endpoint: string;
    aspect: number;
    onUploaded?: () => void;
  }) => (
    <button
      type="button"
      aria-label="Edit genre cover"
      data-endpoint={endpoint}
      data-aspect={String(aspect)}
      onClick={onUploaded}
    />
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

import { Genres } from "./Genres";

const genreDetail = {
  id: 1,
  name: "mathcore",
  slug: "mathcore",
  artist_count: 2,
  album_count: 3,
  mapped: true,
  canonical_slug: "mathcore",
  canonical_name: "Mathcore",
  canonical_description: "Angular hardcore.",
  cover_url: "/api/genres/mathcore/cover?size=640&format=webp",
  artists: [],
  albums: [],
};

const taxonomyTree = {
  nodes: [
    {
      slug: "mathcore",
      name: "Mathcore",
      description: "Angular hardcore.",
      cover_url: "/api/genres/mathcore/cover?size=640&format=webp",
      top_level: false,
      parent_slugs: [],
      children_slugs: [],
      related_slugs: [],
      influenced_by_slugs: [],
      fusion_of_slugs: [],
      alias_names: [],
      artist_count: 2,
      album_count: 3,
    },
  ],
  top_level_slugs: [],
};

function renderGenrePage() {
  return render(
    <MemoryRouter initialEntries={["/genres/mathcore"]}>
      <Routes>
        <Route path="/genres/:slug" element={<Genres />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Genres page", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ ok: true });
    genreRefetchMock.mockReset();
    taxonomyRefetchMock.mockReset();
    useApiMock.mockReset();
    useApiMock.mockImplementation((url: string | null) => {
      if (url === "/api/genres/mathcore") {
        return {
          data: genreDetail,
          loading: false,
          error: null,
          refetch: genreRefetchMock,
        };
      }
      if (url === "/api/genres/taxonomy/tree") {
        return {
          data: taxonomyTree,
          loading: false,
          error: null,
          refetch: taxonomyRefetchMock,
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  it("opens the genre cover cropper from the cover preview", () => {
    renderGenrePage();

    const trigger = screen.getByRole("button", {
      name: "Edit genre cover",
    });

    expect(trigger).toHaveAttribute(
      "data-endpoint",
      "/api/genres/taxonomy/mathcore/cover",
    );
    expect(trigger).toHaveAttribute("data-aspect", "2");
    expect(screen.queryByText("Replace cover")).not.toBeInTheDocument();
    expect(screen.queryByText("Upload cover")).not.toBeInTheDocument();
  });

  it("refreshes and cache-busts the curated cover preview after crop upload", async () => {
    renderGenrePage();

    const cover = screen.getByAltText("Mathcore genre cover");
    expect(cover).toHaveAttribute("src", genreDetail.cover_url);

    fireEvent.click(screen.getByRole("button", { name: "Edit genre cover" }));

    expect(genreRefetchMock).toHaveBeenCalled();
    expect(taxonomyRefetchMock).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByAltText("Mathcore genre cover")).toHaveAttribute(
        "src",
        expect.stringMatching(
          /^\/api\/genres\/mathcore\/cover\?size=640&format=webp&v=/,
        ),
      ),
    );
  });
});
