import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));

import { GenreWheel } from "./GenreWheel";

const taxonomy = {
  nodes: [
    {
      slug: "rock",
      name: "Rock",
      origin: "core" as const,
      top_level: true,
      parent_slugs: [],
      related_slugs: ["indie-rock"],
      influences_slugs: ["indie-rock"],
      artist_count: 8,
      album_count: 12,
      eq_gains: [4, 3, 2, 1, 0, -1, 0, 1, 2, 3],
      eq_preset_source: "direct",
      eq_preset_inherited_from: null,
    },
    {
      slug: "indie-rock",
      name: "Indie Rock",
      origin: "core" as const,
      top_level: false,
      parent_slugs: ["rock"],
      related_slugs: ["rock"],
      influenced_by_slugs: ["rock"],
      artist_count: 3,
      album_count: 4,
      eq_gains: [1, 2, 0, -1, -2, 1, 2, 0, -1, -2],
      eq_preset_source: "inherited",
      eq_preset_inherited_from: "rock",
    },
    {
      slug: "overlay-metal",
      name: "Overlay Metal",
      origin: "overlay" as const,
      top_level: true,
      parent_slugs: ["rock"],
      related_slugs: [],
      artist_count: 2,
      album_count: 1,
      eq_gains: null,
      eq_preset_source: null,
      eq_preset_inherited_from: null,
    },
  ],
  top_level_slugs: ["rock", "overlay-metal"],
  core_taxonomy: {
    taxonomy_id: "crate-core",
    version: "1.0.0",
    digest:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    signature_valid: true,
    key_id: "crate-test-root",
  },
};

describe("GenreWheel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    useApiMock.mockReset();
    useApiMock.mockReturnValue({
      data: taxonomy,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("renders the signed core wheel, excludes overlays, and selects a node", () => {
    const { container } = render(<GenreWheel />);

    expect(
      screen.getByLabelText(
        "Genre taxonomy wheel: 2 core genres in 1 families",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Taxonomy").parentElement).toHaveTextContent(
      "crate-core 1.0.0 · ed25519",
    );
    expect(screen.getByText("GENRES")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Overlay Metal/ }),
    ).not.toBeInTheDocument();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Select a genre on the wheel",
    );

    fireEvent.click(screen.getByRole("button", { name: "indie rock" }));

    const parentEdge = container.querySelector('[data-edge="rock:indie-rock"]');
    expect(parentEdge).toHaveAttribute("stroke", "var(--accent-action-hi)");
    expect(parentEdge).toHaveAttribute("stroke-width", "2.25");
    expect(parentEdge).toHaveAttribute("data-active", "true");

    const relatedEdge = container.querySelector(
      '[data-pair="indie-rock|rock"]',
    );
    expect(relatedEdge).toHaveAttribute("stroke", "var(--accent-action-hi)");
    expect(relatedEdge).toHaveAttribute("data-active", "true");
    expect(relatedEdge).toHaveAttribute("stroke-dasharray", "1.5 4");

    const influenceEdge = container.querySelector(
      '[data-relation="influence"][data-edge="rock:indie-rock"]',
    );
    expect(influenceEdge).toHaveAttribute("data-active", "true");
    expect(influenceEdge).toHaveAttribute("stroke", "#a78bfa");
    expect(influenceEdge?.getAttribute("marker-end")).toMatch(
      /^url\(#.*-influence-arrow\)$/,
    );

    const legend = screen.getByLabelText("Genre wheel relationship legend");
    expect(legend).toHaveTextContent("Parent to subgenre");
    expect(legend).toHaveTextContent("Related, symmetric");
    expect(legend).toHaveTextContent("Influencer to influenced genre");
    expect(legend).toHaveTextContent("Component to fusion genre");
    expect(legend).toHaveTextContent(
      "Arrowheads show direction on selected directed links.",
    );

    fireEvent.click(screen.getByRole("button", { name: /Rock, direct EQ/ }));

    expect(
      screen.getByRole("button", { name: /Rock, direct EQ/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("uses the shared tooltip for wheel nodes instead of SVG title tooltips", async () => {
    const { container } = render(<GenreWheel />);
    const indieRock = screen.getByRole("button", {
      name: "Indie Rock, EQ inherited from rock. Inspect EQ inheritance.",
    });

    expect(indieRock).not.toHaveAttribute("title");
    expect(container.querySelector("[title]")).not.toBeInTheDocument();
    expect(container.querySelector("svg title")).not.toBeInTheDocument();
    await userEvent.hover(indieRock);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Indie Rock · inherited",
    );
  });

  it("updates the EQ inheritance readout when a walk chip is selected", () => {
    render(<GenreWheel />);

    fireEvent.click(screen.getByRole("button", { name: "indie rock" }));

    expect(screen.getByText("indie rock → rock")).toBeVisible();
    expect(screen.getByText("rock", { selector: "strong" })).toBeVisible();
    expect(
      within(screen.getByLabelText("Ten equalizer band gains")).getAllByText(
        "+1",
      ),
    ).not.toHaveLength(0);
  });

  it("keeps an explicit selection fixed through hover, focus, and elapsed time", () => {
    vi.useFakeTimers();
    render(<GenreWheel />);

    const indieRock = screen.getByRole("button", { name: "indie rock" });
    const rock = screen.getByRole("button", { name: /Rock, direct EQ/ });
    fireEvent.click(indieRock);

    expect(indieRock).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Indie Rock")).toBeVisible();
    expect(screen.getByText("3 artists · 4 albums")).toBeVisible();

    fireEvent.pointerEnter(rock);
    fireEvent.focus(rock);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(indieRock).toHaveAttribute("aria-pressed", "true");
    expect(rock).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Indie Rock")).toBeVisible();

    fireEvent.click(rock);
    expect(rock).toHaveAttribute("aria-pressed", "true");
    expect(indieRock).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the canonical wheel geometry in embedded mode and sends selection to its owner", () => {
    const onSelectGenre = vi.fn();
    const { container } = render(
      <GenreWheel
        taxonomyData={taxonomy}
        selectedSlug="indie-rock"
        onSelectGenre={onSelectGenre}
        layout="embedded"
      />,
    );

    const wheel = screen.getByRole("figure", {
      name: "Genre relationship wheel for Indie Rock: 1 direct relationships and 1 derived siblings",
    });
    expect(wheel.querySelectorAll("[data-genre]")).toHaveLength(3);
    expect(wheel).toHaveAttribute("data-layout", "embedded");
    expect(wheel.querySelector('[data-genre="indie-rock"]')).toHaveAttribute(
      "data-role",
      "focus",
    );
    expect(wheel.querySelector('[data-genre="rock"]')).toHaveAttribute(
      "data-role",
      "direct",
    );
    const canonicalPositions = new Map(
      ["rock", "indie-rock"].map((slug) => [
        slug,
        container
          .querySelector(`[data-genre="${slug}"]`)
          ?.getAttribute("transform"),
      ]),
    );
    const { container: unselectedContainer } = render(
      <GenreWheel taxonomyData={taxonomy} layout="embedded" />,
    );
    for (const [slug, transform] of canonicalPositions) {
      expect(
        unselectedContainer.querySelector(`[data-genre="${slug}"]`),
      ).toHaveAttribute("transform", transform);
    }
    expect(
      container.querySelector('[aria-label="EQ inheritance detail"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-edge="rock:indie-rock"][data-active="true"]',
      ),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-genre="rock"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(container.querySelector('[data-genre="rock"]')!);

    expect(onSelectGenre).toHaveBeenCalledWith("rock");
    expect(useApiMock).toHaveBeenCalledWith(null);
  });

  it("places an overlay genre and its real parent on the local wheel", () => {
    const { container } = render(
      <GenreWheel
        taxonomyData={taxonomy}
        selectedSlug="overlay-metal"
        layout="embedded"
      />,
    );

    expect(
      screen.getByRole("figure", {
        name: "Genre relationship wheel for Overlay Metal: 1 direct relationships and 1 derived siblings",
      }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-genre="overlay-metal"]'),
    ).toHaveAttribute("data-role", "focus");
    expect(
      container.querySelector(
        '[data-edge="rock:overlay-metal"][data-active="true"]',
      ),
    ).toBeInTheDocument();
    const overlay = container.querySelector('[data-genre="overlay-metal"]')!;
    const [x, y] = overlay
      .getAttribute("transform")!
      .match(/[\d.]+/g)!
      .map(Number);
    const rock = container.querySelector('[data-genre="rock"]')!;
    const [rockX, rockY] = rock
      .getAttribute("transform")!
      .match(/[\d.]+/g)!
      .map(Number);
    expect(Math.hypot(x! - rockX!, y! - rockY!)).toBeGreaterThan(27.5);
    expect(Math.hypot(x! - rockX!, y! - rockY!)).toBeLessThan(28.5);
  });

  it("reports when the API response does not include the signed core taxonomy", async () => {
    const onUnsupported = vi.fn();
    useApiMock.mockReturnValue({
      data: {
        nodes: taxonomy.nodes.map((node) => ({ ...node, origin: undefined })),
        top_level_slugs: taxonomy.top_level_slugs,
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<GenreWheel onUnsupported={onUnsupported} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Core taxonomy data is unavailable.",
    );
    await waitFor(() => expect(onUnsupported).toHaveBeenCalledOnce());
  });

  it("lights the nearest core connection for a taxonomy tag linked through overlays", () => {
    const localTag = {
      ...taxonomy.nodes[2]!,
      slug: "local-rock-scene",
      name: "Local rock scene",
      top_level: false,
      parent_slugs: ["regional-scene"],
    };
    const sceneTag = {
      ...taxonomy.nodes[2]!,
      slug: "regional-scene",
      name: "Regional scene",
      top_level: false,
      parent_slugs: ["rock"],
    };
    const linkedTaxonomy = {
      ...taxonomy,
      nodes: [...taxonomy.nodes, sceneTag, localTag],
    };

    const { container } = render(
      <GenreWheel
        taxonomyData={linkedTaxonomy}
        selectedSlug="local-rock-scene"
        layout="embedded"
      />,
    );

    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "Core connections for Local rock scene",
    );
    expect(
      container.querySelector('[data-genre="local-rock-scene"]'),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      container.querySelector('[data-edge="rock:indie-rock"]'),
    ).not.toHaveAttribute("data-active", "true");
  });

  it("shows an overlay's direct relationships and derived same-parent context", () => {
    const postRock = {
      ...taxonomy.nodes[1]!,
      slug: "post-rock",
      name: "Post Rock",
      parent_slugs: ["rock"],
      related_slugs: ["indie-rock"],
    };
    const sceneTag = {
      ...taxonomy.nodes[2]!,
      slug: "rock-scene",
      name: "Rock scene",
      parent_slugs: ["rock"],
      influenced_by_slugs: ["indie-rock"],
    };
    const linkedTaxonomy = {
      ...taxonomy,
      nodes: [...taxonomy.nodes.slice(0, 2), postRock, sceneTag],
    };

    const { container } = render(
      <GenreWheel
        taxonomyData={linkedTaxonomy}
        selectedSlug="rock-scene"
        layout="embedded"
      />,
    );

    expect(container.querySelector('[data-genre="rock"]')).not.toHaveAttribute(
      "opacity",
      "0.25",
    );
    expect(
      container.querySelector('[data-genre="indie-rock"]'),
    ).toHaveAttribute("opacity", "1");
    expect(container.querySelector('[data-genre="rock"]')).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      container.querySelector('[data-genre="rock"] circle'),
    ).toHaveAttribute("fill", "var(--accent-action)");
    expect(
      container.querySelector('[data-genre="indie-rock"]'),
    ).toHaveAttribute("data-active", "true");
    expect(
      container.querySelector('[data-genre="indie-rock"] circle'),
    ).toHaveAttribute("fill", "var(--accent-action)");
    expect(container.querySelector('[data-genre="post-rock"]')).toHaveAttribute(
      "opacity",
      "0.82",
    );
    expect(container.querySelector('[data-genre="post-rock"]')).toHaveAttribute(
      "data-role",
      "sibling",
    );
    expect(
      container.querySelector(
        '[data-relation="sibling-derived"][data-pair="post-rock|rock-scene"]',
      ),
    ).toHaveAttribute("data-active", "true");
    expect(
      container.querySelector('[data-edge="rock:post-rock"]'),
    ).not.toHaveAttribute("data-active", "true");
  });

  it("activates only edges that directly touch a selected core genre", () => {
    const postRock = {
      ...taxonomy.nodes[1]!,
      slug: "post-rock",
      name: "Post Rock",
      parent_slugs: ["rock"],
      related_slugs: ["indie-rock"],
    };
    const linkedTaxonomy = {
      ...taxonomy,
      nodes: [...taxonomy.nodes.slice(0, 2), postRock, taxonomy.nodes[2]!],
    };
    const { container } = render(
      <GenreWheel
        taxonomyData={linkedTaxonomy}
        selectedSlug="rock"
        layout="embedded"
      />,
    );

    expect(
      container.querySelector('[data-edge="rock:indie-rock"]'),
    ).toHaveAttribute("data-active", "true");
    expect(
      container.querySelector('[data-edge="rock:post-rock"]'),
    ).toHaveAttribute("data-active", "true");
    expect(container.querySelector('[data-genre="rock"]')).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      container.querySelector('[data-genre="indie-rock"]'),
    ).toHaveAttribute("data-active", "true");
    expect(
      container.querySelector('[data-genre="indie-rock"] circle'),
    ).toHaveAttribute("fill", "var(--accent-action)");
    expect(
      container.querySelector('[data-pair="indie-rock|post-rock"]'),
    ).not.toHaveAttribute("data-active", "true");
  });

  it("explains when a selected overlay has no relationship to the core wheel", () => {
    const orphan = {
      ...taxonomy.nodes[2]!,
      parent_slugs: [],
      related_slugs: [],
    };
    render(
      <GenreWheel
        taxonomyData={{
          ...taxonomy,
          nodes: [...taxonomy.nodes.slice(0, 2), orphan],
        }}
        selectedSlug="overlay-metal"
        layout="embedded"
      />,
    );

    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "Overlay Metal has no linked core genre yet",
    );
  });
});
