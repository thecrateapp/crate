import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("@/components/genres/GenreEqEditor", () => ({
  GenreEqEditor: () => <div>EQ editor</div>,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { GenreTaxonomyTree } from "./GenreTaxonomyTree";

const taxonomyTree = {
  nodes: [
    {
      slug: "hardcore",
      name: "Hardcore",
      description: "Fast, direct, and loud.",
      musicbrainz_mbid: null,
      wikidata_url: null,
      top_level: true,
      parent_slugs: [],
      children_slugs: [],
      alias_names: [],
      artist_count: 12,
      album_count: 34,
      eq_gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      eq_preset_source: "direct",
      eq_preset_inherited_from: null,
    },
  ],
  top_level_slugs: ["hardcore"],
};

function renderTree(
  props: Partial<ComponentProps<typeof GenreTaxonomyTree>> = {},
) {
  return render(
    <MemoryRouter>
      <GenreTaxonomyTree {...props} />
    </MemoryRouter>,
  );
}

describe("GenreTaxonomyTree", () => {
  beforeEach(() => {
    useApiMock.mockReturnValue({
      data: taxonomyTree,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("hides curator actions and EQ editor for read-only users", () => {
    renderTree();

    fireEvent.click(screen.getByText("Hardcore"));

    expect(screen.queryByText("Sync MusicBrainz")).not.toBeInTheDocument();
    expect(screen.queryByText("Infer taxonomy")).not.toBeInTheDocument();
    expect(screen.queryByText("Generate playlist")).not.toBeInTheDocument();
    expect(screen.queryByText("EQ editor")).not.toBeInTheDocument();
    expect(screen.getByText("Full detail page")).toBeInTheDocument();
  });

  it("shows taxonomy and playlist actions for capable users", () => {
    renderTree({ canCurate: true, canCreatePlaylists: true });

    fireEvent.click(screen.getByText("Hardcore"));

    expect(screen.getByText("Sync MusicBrainz")).toBeInTheDocument();
    expect(screen.getByText("Infer taxonomy")).toBeInTheDocument();
    expect(screen.getByText("Generate playlist")).toBeInTheDocument();
    expect(screen.getByText("EQ editor")).toBeInTheDocument();
  });
});
