import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, useApiMock, useActionLLMStatusMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
  useActionLLMStatusMock: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/AuthContext")>()),
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

vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: useActionLLMStatusMock,
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

vi.mock("@/components/genres/GenreTaxonomyExplorer", () => ({
  GenreTaxonomyExplorer: ({
    filter,
    onUnsupported,
    selectedSlug,
    onSelectGenre,
  }: {
    filter: string;
    onUnsupported?: () => void;
    selectedSlug?: string | null;
    onSelectGenre?: (slug: string | null) => void;
  }) => (
    <div
      data-testid="genre-taxonomy-explorer"
      data-selected-slug={selectedSlug ?? ""}
    >
      Genre taxonomy explorer {filter}
      <button type="button" onClick={() => onSelectGenre?.("mathcore")}>
        Select Mathcore
      </button>
      <button type="button" onClick={onUnsupported}>
        Simulate unsupported wheel
      </button>
    </div>
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

function CurrentLocation() {
  const location = useLocation();
  return (
    <output aria-label="Current location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderGenrePage(initialEntry = "/genres/mathcore") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/genres" element={<Genres />} />
        <Route path="/genres/:slug" element={<Genres />} />
      </Routes>
      <CurrentLocation />
    </MemoryRouter>,
  );
}

function renderGenreList() {
  return render(
    <MemoryRouter initialEntries={["/genres"]}>
      <Routes>
        <Route path="/genres" element={<Genres />} />
        <Route path="/genres/:slug" element={<Genres />} />
      </Routes>
      <CurrentLocation />
    </MemoryRouter>,
  );
}

describe("Genres page", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ ok: true });
    useActionLLMStatusMock.mockReturnValue(null);
    useApiMock.mockReset();
    useApiMock.mockImplementation((url: string | null) => {
      if (url === "/api/genres") {
        return {
          data: [
            {
              id: 1,
              name: "Rock",
              slug: "rock",
              artist_count: 3,
              album_count: 5,
              mapped: true,
            },
          ],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (url === "/api/genres/unmapped?limit=100") {
        return { data: [], loading: false, error: null, refetch: vi.fn() };
      }
      if (url === "/api/genres/sound-intelligence/health") {
        return {
          data: {
            eq: {
              total_genres: 12,
              sources: [
                { source: "genre_taxonomy_preset", count: 4, percent: 33 },
                {
                  source: "genre_taxonomy_inherited_preset",
                  count: 3,
                  percent: 25,
                },
                { source: "no_genre_eq", count: 5, percent: 42 },
              ],
            },
            taxonomy: {
              node_count: 10,
              top_level_count: 2,
              orphan_count: 1,
              missing_description_count: 2,
              missing_direct_eq_count: 3,
              missing_effective_eq_count: 2,
              unmapped_raw_count: 4,
              edge_count: 7,
              locked_edge_count: 5,
              manual_edge_count: 2,
              ai_edge_count: 0,
            },
            listening_priorities: [
              {
                slug: "grime",
                name: "Grime",
                weighted_play_count: 31.5,
                listening_share_90d_pct: 4.3,
              },
            ],
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  it("uses the taxonomy explorer by default and retains the tag grid", () => {
    renderGenreList();

    expect(screen.getByTestId("genre-taxonomy-explorer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.getByRole("button", { name: "Rock" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Taxonomy explorer" }));

    expect(screen.getByTestId("genre-taxonomy-explorer")).toBeInTheDocument();
  });

  it("opens the wheel with a selected genre when an old detail URL is used", async () => {
    renderGenrePage();

    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      "/genres?genre=mathcore",
    );
    expect(screen.getByTestId("genre-taxonomy-explorer")).toHaveAttribute(
      "data-selected-slug",
      "mathcore",
    );
  });

  it("selects mapped list entries in the taxonomy wheel instead of the old detail page", () => {
    renderGenreList();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    fireEvent.click(screen.getByRole("button", { name: "Rock" }));

    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      "/genres?genre=rock",
    );
    expect(
      screen.getByRole("button", { name: "Taxonomy explorer" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("genre-taxonomy-explorer")).toHaveAttribute(
      "data-selected-slug",
      "rock",
    );
  });

  it("does not make unmapped raw tags look like links to a genre detail page", () => {
    useApiMock.mockImplementation((url: string | null) => {
      if (url === "/api/genres") {
        return {
          data: [],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (url === "/api/genres/unmapped?limit=100") {
        return {
          data: [
            {
              id: 2,
              name: "Drone metal",
              slug: "drone-metal",
              artist_count: 1,
              album_count: 1,
              mapped: false,
            },
          ],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    renderGenreList();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));

    expect(screen.getByText("Drone metal")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Drone metal" }),
    ).not.toBeInTheDocument();
  });

  it("keeps wheel selection in the URL so it can be shared or restored", () => {
    renderGenreList();
    fireEvent.click(screen.getByRole("button", { name: "Select Mathcore" }));

    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      "/genres?genre=mathcore",
    );
  });

  it("places icon-only taxonomy controls in the page header and gives search the full panel width", () => {
    renderGenreList();

    const headerActions = screen.getByRole("group", {
      name: "Genre taxonomy controls",
    });
    expect(headerActions).toContainElement(
      screen.getByRole("button", { name: "Hide empty genres" }),
    );
    expect(headerActions).not.toHaveTextContent("Non-empty only");
    expect(headerActions.closest("header")).not.toBeNull();

    const search = screen.getByPlaceholderText("Filter genres...");
    expect(search.parentElement).toHaveClass("w-full");
    expect(search.parentElement).not.toHaveClass("max-w-xl");
  });

  it("uses the common mono numeric role for taxonomy health counts", () => {
    renderGenreList();
    for (const label of [
      "Needs mapping",
      "Orphan nodes",
      "No genre EQ",
      "Missing copy",
    ]) {
      const count = screen.getByText(label).parentElement?.querySelector("dd");
      expect(count).toHaveClass("font-mono", "font-normal", "tabular-nums");
      expect(count).not.toHaveClass("font-display", "font-semibold");
    }
  });

  it("keeps Sound Intelligence above the taxonomy content in both views", () => {
    renderGenreList();

    const soundIntelligence = screen.getByRole("region", {
      name: "Genre EQ coverage and taxonomy health",
    });
    const soundIntelligenceHeading = soundIntelligence.querySelector("h2");
    expect(soundIntelligenceHeading).toHaveTextContent(/sound intelligence/i);
    expect(soundIntelligenceHeading).not.toHaveTextContent(/^01/);
    const taxonomy = screen.getByRole("heading", { name: "Genre taxonomy" });
    expect(
      soundIntelligence.compareDocumentPosition(taxonomy) & 4,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(
      soundIntelligence.compareDocumentPosition(taxonomy) & 4,
    ).toBeTruthy();
  });

  it("uses gray MonoLabels and the Listen hover recipe for EQ coverage rows", () => {
    renderGenreList();

    const label = screen.getByText("Direct genre EQ");
    const sourceRow = label.closest(".group");
    expect(label).toHaveClass(
      "crate-mono-label",
      "text-text-subtle",
      "uppercase",
      "group-hover:text-accent-action-hi",
    );
    expect(screen.getByText("4 · 33%")).toHaveClass(
      "crate-mono-label",
      "text-text-subtle",
      "uppercase",
      "group-hover:text-accent-action-hi",
    );
    expect(sourceRow).toHaveClass("hover:bg-[var(--hover-bg)]");
    expect(sourceRow?.className).not.toMatch(/hover:border-accent/);
    expect(label.closest(".divide-y")).toBeNull();
  });

  it("shows actionable listening priorities without an effective genre preset", async () => {
    const user = userEvent.setup();
    renderGenreList();

    expect(
      screen.getByRole("region", { name: "Listening-led genre EQ priorities" }),
    ).toHaveTextContent("Most listened without genre EQ");
    expect(
      screen.getByRole("button", { name: "Review Grime genre" }),
    ).toHaveTextContent("31.5 weighted plays");
    expect(screen.getByText("Inherited genre EQ")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Review Grime genre" }),
    );
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      "/genres?genre=grime",
    );
  });

  it("opens taxonomy maintenance from the shared page header", async () => {
    renderGenreList();
    const user = userEvent.setup();

    const maintenanceButton = screen.getByRole("button", {
      name: "Taxonomy maintenance",
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(maintenanceButton);
    const maintenance = screen.getByRole("menu");
    expect(maintenance).toBeVisible();
    expect(maintenance.querySelectorAll('[role="group"]')).toHaveLength(3);
    for (const section of ["External sources", "Taxonomy curation", "Index"]) {
      expect(screen.getByText(section)).toHaveClass("crate-mono-label");
    }
    expect(
      screen.getByRole("menuitem", { name: "Sync MusicBrainz" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Enrich descriptions" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Infer taxonomy" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Build proposal with AI" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Clean invalid nodes" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Re-index genres" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Taxonomy maintenance" }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("applies Hide empty genres to mapped and unmapped rows in grid view", () => {
    useApiMock.mockImplementation((url: string | null) => {
      if (url === "/api/genres") {
        return {
          data: [
            {
              id: 1,
              name: "Rock",
              slug: "rock",
              artist_count: 3,
              album_count: 5,
              mapped: true,
            },
            {
              id: 2,
              name: "Empty ambient",
              slug: "empty-ambient",
              artist_count: 0,
              album_count: 0,
              mapped: true,
            },
          ],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (url === "/api/genres/unmapped?limit=100") {
        return {
          data: [
            {
              id: 3,
              name: "Ghost tag",
              slug: "ghost-tag",
              artist_count: 0,
              album_count: 0,
              mapped: false,
            },
            {
              id: 4,
              name: "Live tag",
              slug: "live-tag",
              artist_count: 2,
              album_count: 1,
              mapped: false,
            },
          ],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    renderGenreList();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.getByText("Empty ambient")).toBeVisible();
    expect(screen.getByText("Ghost tag")).toBeVisible();
    expect(screen.getByText("Live tag")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Hide empty genres" }));

    expect(screen.queryByText("Empty ambient")).not.toBeInTheDocument();
    expect(screen.queryByText("Ghost tag")).not.toBeInTheDocument();
    expect(screen.getByText("Live tag")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Show empty genres" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("classifies an unmapped grid tag as a facet with its icon action", async () => {
    const user = userEvent.setup();
    useApiMock.mockImplementation((url: string | null) => {
      if (url === "/api/genres") {
        return {
          data: [
            {
              id: 7,
              name: "Instrumental",
              slug: "instrumental",
              artist_count: 4,
              album_count: 5,
              mapped: false,
            },
          ],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (url === "/api/genres/unmapped?limit=100") {
        return {
          data: [
            {
              id: 7,
              name: "Instrumental",
              slug: "instrumental",
              artist_count: 4,
              album_count: 5,
              mapped: false,
            },
          ],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    renderGenreList();
    await user.click(screen.getByRole("button", { name: "Grid view" }));
    expect(
      screen.queryByRole("button", { name: "Enrich Instrumental with AI" }),
    ).not.toBeInTheDocument();
    const facetButton = screen.getAllByRole("button", {
      name: "Mark Instrumental as facet",
    })[0];
    expect(facetButton).toBeDefined();
    if (!facetButton) throw new Error("Facet action was not rendered");
    await user.click(facetButton);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/genres/taxonomy/raw-tags/instrumental/classification",
        "PUT",
        { classification: "facet", facets: [] },
      ),
    );
  });

  it("shows AI enrichment only when configured and reviews raw-tag proposals before applying", async () => {
    const user = userEvent.setup();
    useActionLLMStatusMock.mockReturnValue({ available: true });
    useApiMock.mockImplementation((url: string | null) => {
      if (url === "/api/genres") {
        return {
          data: [
            {
              id: 8,
              name: "Dream pop",
              slug: "dream-pop",
              artist_count: 3,
              album_count: 4,
              mapped: false,
            },
          ],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (url === "/api/genres/unmapped?limit=100") {
        return {
          data: [
            {
              id: 8,
              name: "Dream pop",
              slug: "dream-pop",
              artist_count: 3,
              album_count: 4,
              mapped: false,
            },
          ],
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    apiMock.mockImplementation((path: string) => {
      if (path.endsWith("/proposal")) {
        return Promise.resolve({
          ok: true,
          slug: "dream-pop",
          name: "Dream pop",
          source_kind: "raw_genre",
          recommended_action: "classify_facet",
          description: "",
          aliases: [],
          relations: [],
          facets: [
            {
              dimension: "mood",
              slug: "dreamy",
              name: "Dreamy",
            },
          ],
          reasoning: "The tag describes a mood rather than a taxonomy genre.",
        });
      }
      return Promise.resolve({ ok: true });
    });

    renderGenreList();
    await user.click(screen.getByRole("button", { name: "Grid view" }));
    const enrichButtons = screen.getAllByRole("button", {
      name: "Enrich Dream pop with AI",
    });
    expect(enrichButtons).toHaveLength(2);
    const enrichButton = enrichButtons[0];
    if (!enrichButton) throw new Error("AI action was not rendered");
    await user.click(enrichButton);

    expect(
      await screen.findByRole("heading", {
        name: "AI proposal · Dream pop",
      }),
    ).toBeVisible();
    expect(screen.getByText("Classify as a facet")).toBeVisible();
    expect(screen.getByText("mood · Dreamy")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Apply proposal" }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/genres/taxonomy/dream-pop/proposal/apply",
        "POST",
        expect.objectContaining({
          source_kind: "raw_genre",
          recommended_action: "classify_facet",
          facets: [{ dimension: "mood", name: "Dreamy" }],
        }),
      ),
    );
  });

  it("falls back to the tag grid when the wheel API lacks core taxonomy data", () => {
    renderGenreList();

    fireEvent.click(
      screen.getByRole("button", { name: "Simulate unsupported wheel" }),
    );

    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(
        "Showing the tag grid until core taxonomy data is available.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByTestId("genre-taxonomy-explorer"),
    ).not.toBeInTheDocument();
  });

  it("keeps the Genres heading and a retry action when its first load fails", async () => {
    const refetch = vi.fn();
    useApiMock.mockImplementation((url: string | null) =>
      url === "/api/genres"
        ? { data: null, loading: false, error: "offline", refetch }
        : { data: null, loading: false, error: null, refetch: vi.fn() },
    );

    renderGenreList();

    expect(
      screen.getByRole("heading", { level: 1, name: "Genres" }),
    ).toBeVisible();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load the genre catalog.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("offers a clear-search action when the genre filter has no matches", () => {
    useApiMock.mockImplementation((url: string | null) =>
      url === "/api/genres"
        ? {
            data: [
              {
                id: 4,
                name: "Mathcore",
                slug: "mathcore",
                artist_count: 2,
                album_count: 3,
                mapped: true,
              },
            ],
            loading: false,
            error: null,
            refetch: vi.fn(),
          }
        : { data: null, loading: false, error: null, refetch: vi.fn() },
    );

    renderGenreList();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    fireEvent.change(screen.getByPlaceholderText("Filter genres..."), {
      target: { value: "ambient" },
    });

    expect(
      screen.getByRole("heading", { name: "No genres match this search" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Mathcore")).toBeVisible();
  });
});
