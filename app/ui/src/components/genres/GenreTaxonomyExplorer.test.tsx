import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/genres/GenreEqEditor", () => ({
  GenreEqEditor: () => <div>EQ editor</div>,
}));
vi.mock("@/components/ImageCropUpload", () => ({
  ImageCropUpload: ({ label }: { label: string }) => <button>{label}</button>,
}));

import { GenreTaxonomyExplorer } from "./GenreTaxonomyExplorer";

const taxonomy = {
  nodes: [
    {
      slug: "rock",
      name: "Rock",
      origin: "core" as const,
      cover_url: "/api/genres/rock/cover?size=640&format=webp",
      description: null,
      musicbrainz_mbid: null,
      wikidata_url: null,
      top_level: true,
      parent_slugs: [],
      children_slugs: ["punk", "local-scene-tag"],
      related_slugs: [],
      influenced_by_slugs: [],
      influences_slugs: ["punk"],
      fusion_of_slugs: [],
      fusion_genre_slugs: [],
      alias_names: [],
      artist_count: 4,
      album_count: 8,
      track_count: 42,
      raw_tag_count: 2,
      mapped_raw_tags: ["rock", "classic rock"],
      catalog_track_count: 100,
      catalog_track_share_pct: 42,
      listening_share_90d_pct: 18.5,
      eq_gains: Array(10).fill(2),
      eq_preset_source: "direct",
      eq_preset_inherited_from: null,
    },
    {
      slug: "local-scene-tag",
      name: "Local Scene Tag",
      origin: "overlay" as const,
      description: "A local tag linked to rock.",
      cover_url: "/api/genres/local-scene-tag/cover?size=640&format=webp",
      musicbrainz_mbid: null,
      wikidata_url: null,
      top_level: false,
      parent_slugs: ["rock"],
      children_slugs: [],
      related_slugs: [],
      influenced_by_slugs: [],
      influences_slugs: [],
      fusion_of_slugs: [],
      fusion_genre_slugs: [],
      alias_names: [],
      artist_count: 0,
      album_count: 0,
      track_count: 0,
      raw_tag_count: 0,
      mapped_raw_tags: [],
      catalog_track_count: 100,
      catalog_track_share_pct: 0,
      listening_share_90d_pct: null,
      eq_gains: null,
      eq_preset_source: null,
      eq_preset_inherited_from: null,
    },
    {
      slug: "unlinked-local-tag",
      name: "Unlinked local tag",
      origin: "overlay" as const,
      description: null,
      cover_url: "/api/genres/unlinked-local-tag/cover?size=640&format=webp",
      musicbrainz_mbid: null,
      wikidata_url: null,
      top_level: true,
      parent_slugs: [],
      children_slugs: [],
      related_slugs: [],
      influenced_by_slugs: [],
      influences_slugs: [],
      fusion_of_slugs: [],
      fusion_genre_slugs: [],
      alias_names: [],
      artist_count: 0,
      album_count: 0,
      eq_gains: null,
      eq_preset_source: null,
      eq_preset_inherited_from: null,
    },
    {
      slug: "punk",
      name: "Punk",
      origin: "core" as const,
      description: null,
      musicbrainz_mbid: null,
      wikidata_url: null,
      top_level: false,
      parent_slugs: ["rock"],
      children_slugs: [],
      related_slugs: [],
      influenced_by_slugs: ["rock"],
      influences_slugs: [],
      fusion_of_slugs: [],
      fusion_genre_slugs: [],
      alias_names: [],
      artist_count: 2,
      album_count: 3,
      track_count: 15,
      raw_tag_count: 1,
      mapped_raw_tags: ["punk"],
      catalog_track_count: 100,
      catalog_track_share_pct: 15,
      listening_share_90d_pct: 7.5,
      eq_gains: Array(10).fill(1),
      eq_preset_source: "inherited",
      eq_preset_inherited_from: "rock",
    },
  ],
  top_level_slugs: ["rock", "unlinked-local-tag"],
  core_taxonomy: {
    taxonomy_id: "crate-core",
    version: "1.0.0",
    digest: "sha256:0123456789abcdef",
    signature_valid: true,
    key_id: "crate-test-root",
  },
};

describe("GenreTaxonomyExplorer", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    useApiMock.mockReturnValue({
      data: taxonomy,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("keeps the full wheel visible and synchronizes selection both ways", async () => {
    render(
      <MemoryRouter>
        <GenreTaxonomyExplorer />
      </MemoryRouter>,
    );

    const wheel = screen.getByRole("figure", {
      name: "Genre taxonomy wheel: 2 core genres in 1 families",
    });
    expect(wheel.querySelectorAll("[data-genre]")).toHaveLength(2);
    expect(wheel).toHaveAttribute("data-layout", "embedded");
    expect(screen.queryByLabelText("EQ inheritance detail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rock4" }));
    expect(
      screen.getByRole("region", { name: "Genre summary for Rock" }),
    ).toHaveTextContent("42");
    expect(
      screen.getByRole("meter", { name: "Listening share · 90 days" }),
    ).toHaveAttribute("aria-valuetext", "18.5%");
    expect(
      screen.getByRole("button", { name: /Rock, direct EQ/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      wheel.querySelector('[data-edge="rock:punk"][data-active="true"]'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Punk, EQ inherited/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Punk2" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(
      screen.getByRole("button", { name: /Punk, EQ inherited/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("region", { name: "Genre management for Punk" }),
    ).toHaveTextContent("Genre management");
  });

  it("uses a route-provided selection and reports wheel changes to the route", () => {
    const onSelectGenre = vi.fn();
    render(
      <MemoryRouter>
        <GenreTaxonomyExplorer
          selectedSlug="punk"
          onSelectGenre={onSelectGenre}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: /Punk, EQ inherited/ }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Rock, direct EQ/ }));

    expect(onSelectGenre).toHaveBeenCalledWith("rock");
    expect(
      screen.getByRole("button", { name: /Punk, EQ inherited/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("stacks genre management under the wheel and summary, independently of tree height", () => {
    const { container } = render(
      <MemoryRouter>
        <GenreTaxonomyExplorer />
      </MemoryRouter>,
    );

    const tree = screen.getByRole("region", { name: "Genre taxonomy tree" });
    const management = screen.getByRole("region", { name: "Genre management" });
    const content = management.parentElement;

    expect(content).toHaveClass("genre-taxonomy-explorer__content");
    expect(content).toContainElement(
      screen.getByRole("region", { name: "Selected genre wheel" }),
    );
    expect(content).toContainElement(
      screen.getByRole("region", { name: "Genre summary" }),
    );
    expect(content).not.toContainElement(tree);
    const visual = container.querySelector(
      ".genre-taxonomy-explorer__visual",
    );
    expect(visual?.nextElementSibling).toBe(management);
  });

  it("keeps save and delete controls inside the selected genre container", () => {
    render(
      <MemoryRouter>
        <GenreTaxonomyExplorer canCurate />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rock4" }));

    const management = screen.getByRole("region", {
      name: "Genre management for Rock",
    });
    const nodeHeader = within(management).getByRole("heading", {
      name: "Rock",
    }).parentElement?.parentElement;
    expect(nodeHeader).toHaveAttribute("data-slot", "genre-node-header");
    expect(
      within(nodeHeader as HTMLElement).getByRole("button", {
        name: "Save genre metadata",
      }),
    ).toBeVisible();
    expect(
      within(nodeHeader as HTMLElement).getByRole("button", {
        name: "Delete genre",
      }),
    ).toBeVisible();
    expect(
      within(management.querySelector("header") as HTMLElement).queryByRole(
        "button",
      ),
    ).toBeNull();
  });

  it("keeps all selected-genre relationships visible while the tree is filtered", () => {
    const { container } = render(
      <MemoryRouter>
        <GenreTaxonomyExplorer filter="rock" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rock4" }));

    const relatedPunk = container.querySelector('[data-genre="punk"]');
    expect(relatedPunk).toHaveAttribute("opacity", "1");
    expect(
      container.querySelector('[data-edge="rock:punk"][data-active="true"]'),
    ).toBeInTheDocument();
  });

  it("lets related-genre links drive the tree, wheel, and summary selection", () => {
    render(
      <MemoryRouter>
        <GenreTaxonomyExplorer />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rock4" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Select Punk, subgenres" }),
    );

    expect(
      screen.getByRole("region", { name: "Genre summary for Punk" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Punk, EQ inherited/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("region", { name: "Genre management for Punk" }),
    ).toBeInTheDocument();
  });

  it("maps a selected overlay genre to its linked core nodes", () => {
    const { container } = render(
      <MemoryRouter>
        <GenreTaxonomyExplorer canCurate />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand Rock" }));
    fireEvent.click(screen.getByRole("button", { name: /Local Scene Tag/ }));

    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "Core connections for Local Scene Tag",
    );
    expect(
      container.querySelector(
        '[data-genre="local-scene-tag"][data-selected="true"]',
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-genre="rock"][data-role="direct"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-edge="rock:punk"][data-active="true"]'),
    ).not.toBeInTheDocument();
    const management = screen.getByRole("region", {
      name: "Genre management for Local Scene Tag",
    });
    expect(management).toHaveTextContent("A local tag linked to rock.");
    expect(management).toHaveTextContent("EQ editor");
    expect(management).toHaveTextContent("Edit cover");
  });

  it("explains when a selected overlay has no core relationship to illuminate", () => {
    render(
      <MemoryRouter>
        <GenreTaxonomyExplorer />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Unlinked local tag/ }));

    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "Unlinked local tag has no linked core genre yet",
    );
    expect(
      screen.getByRole("button", { name: /Unlinked local tag, no EQ/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Rock, direct EQ/ }),
    ).toHaveAttribute("opacity", "0.25");
  });
});
