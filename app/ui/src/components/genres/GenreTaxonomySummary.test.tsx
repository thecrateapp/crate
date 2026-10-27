import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TaxonomyNode } from "./GenreTaxonomyTree";
import { GenreTaxonomySummary } from "./GenreTaxonomySummary";

function genre(
  slug: string,
  overrides: Partial<TaxonomyNode> = {},
): TaxonomyNode {
  return {
    slug,
    name: slug.replace(/-/g, " "),
    origin: "core",
    description: null,
    musicbrainz_mbid: null,
    wikidata_url: null,
    top_level: false,
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
    track_count: 0,
    raw_tag_count: 0,
    mapped_raw_tags: [],
    catalog_track_count: 0,
    catalog_track_share_pct: 0,
    listening_share_90d_pct: null,
    eq_gains: null,
    eq_preset_source: null,
    eq_preset_inherited_from: null,
    ...overrides,
  };
}

describe("GenreTaxonomySummary", () => {
  it("keeps derived shared-parent context distinct from related links and shows fusion directions separately", () => {
    const selected = genre("punk", {
      parent_slugs: ["rock"],
      related_slugs: ["emo"],
      influenced_by_slugs: ["rock"],
      influences_slugs: ["post-hardcore"],
      fusion_of_slugs: ["hardcore-punk"],
      fusion_genre_slugs: ["melodic-hardcore"],
    });
    const nodes = [
      genre("rock", { children_slugs: ["punk", "emo"] }),
      selected,
      genre("emo"),
      genre("post-hardcore"),
      genre("hardcore-punk"),
      genre("melodic-hardcore"),
    ];
    const onSelectGenre = vi.fn();

    render(
      <GenreTaxonomySummary
        node={selected}
        nodes={nodes}
        onSelectGenre={onSelectGenre}
      />,
    );

    const summary = screen.getByRole("region", {
      name: "Genre summary for punk",
    });
    const sharedParent = within(summary).getByRole("group", {
      name: "Shared parent (derived)",
    });
    const related = within(summary).getByRole("group", { name: "Related" });
    const relatedPill = within(related).getByRole("button", { name: "emo" });
    expect(
      within(sharedParent).getByRole("button", { name: "emo" }),
    ).toBeInTheDocument();
    expect(relatedPill).toHaveClass("genre-pill", "crate-touch-target");
    expect(relatedPill).not.toHaveAttribute("title");
    expect(
      within(
        within(summary).getByRole("group", { name: "Fusion of" }),
      ).getByRole("button", { name: "hardcore punk" }),
    ).toBeInTheDocument();
    expect(
      within(
        within(summary).getByRole("group", {
          name: "Fusions containing this genre",
        }),
      ).getByRole("button", { name: "melodic hardcore" }),
    ).toBeInTheDocument();
    fireEvent.click(relatedPill);
    expect(onSelectGenre).toHaveBeenCalledWith("emo");
  });
});
