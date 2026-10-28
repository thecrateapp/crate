import { describe, expect, it } from "vitest";

import {
  buildLocalGenreWheelModel,
  buildGenreWheelModel,
  formatGenreWheelGain,
  resolveGenreWheelEqPath,
  resolveOverlayCoreTargets,
  type GenreWheelTaxonomyNode,
} from "./genre-wheel-model";

const node = (
  slug: string,
  overrides: Partial<GenreWheelTaxonomyNode> = {},
): GenreWheelTaxonomyNode => ({
  slug,
  name: slug,
  origin: "core",
  top_level: false,
  parent_slugs: [],
  related_slugs: [],
  artist_count: 0,
  album_count: 0,
  eq_gains: null,
  eq_preset_source: null,
  eq_preset_inherited_from: null,
  ...overrides,
});

describe("genre wheel model", () => {
  it("builds a local wheel with every direct edge, derived siblings and nearby context", () => {
    const model = buildLocalGenreWheelModel(
      [
        node("dark-ambient", {
          origin: "overlay",
          parent_slugs: ["ambient", "drone", "electronic"],
          fusion_of_slugs: ["industrial", "noise"],
          related_slugs: ["experimental"],
        }),
        node("ambient", { top_level: true, children_slugs: ["dark-ambient"] }),
        node("drone", { top_level: true }),
        node("electronic", { top_level: true, influences_slugs: ["techno"] }),
        node("industrial", { top_level: true }),
        node("noise", { top_level: true }),
        node("experimental", { top_level: true }),
        node("downtempo", { parent_slugs: ["electronic"] }),
        node("techno", { parent_slugs: ["electronic"] }),
        node("minimal-wave", { parent_slugs: ["electronic"] }),
      ],
      "dark-ambient",
    );

    expect(model.focusSlug).toBe("dark-ambient");
    const darkAmbient = model.positions.get("dark-ambient")!;
    const ambient = model.positions.get("ambient")!;
    expect(darkAmbient.ring).toBe(1);
    expect(Math.hypot(darkAmbient.x - ambient.x, darkAmbient.y - ambient.y)).toBeCloseTo(28);
    expect(new Set(model.directSlugs)).toEqual(
      new Set([
        "electronic",
        "ambient",
        "industrial",
        "drone",
        "experimental",
        "noise",
      ]),
    );
    expect(model.siblingPairs).toEqual([
      "dark-ambient|downtempo",
      "dark-ambient|minimal-wave",
      "dark-ambient|techno",
    ]);
    expect(model.contextSlugs).toEqual([]);
    expect(model.parentEdges).toContainEqual({ slug: "dark-ambient", parent: "ambient" });
    expect(model.parentEdges).toContainEqual({ slug: "downtempo", parent: "electronic" });
    expect(model.semanticEdges).toContainEqual({
      source: "industrial",
      target: "dark-ambient",
      type: "fusion",
    });
  });

  it("caps nearby context without dropping direct relationships", () => {
    const context = Array.from({ length: 5 }, (_, index) =>
      node(`context-${index}`, { origin: "overlay" }),
    );
    const model = buildLocalGenreWheelModel(
      [
        node("focus", { related_slugs: ["direct"] }),
        node("direct", { top_level: true, related_slugs: context.map((item) => item.slug) }),
        ...context,
      ],
      "focus",
      2,
    );

    expect(model.directSlugs).toEqual(["direct"]);
    expect(model.contextSlugs).toEqual(["context-0", "context-1"]);
    expect(model.positions.has("direct")).toBe(true);
    expect(model.positions.has("context-2")).toBe(false);
  });

  it("keeps a selected core genre at its canonical wheel position", () => {
    const genres = [
      node("rock", { top_level: true }),
      node("alternative", { top_level: true }),
      node("indie-rock", { parent_slugs: ["alternative"] }),
      node("dream-pop", { parent_slugs: ["alternative"] }),
    ];
    const canonical = buildGenreWheelModel(genres);
    const local = buildLocalGenreWheelModel(genres, "indie-rock");

    expect(local.positions.get("indie-rock")).toEqual(
      canonical.positions.get("indie-rock"),
    );
    expect(local.positions.get("dream-pop")).toEqual(
      canonical.positions.get("dream-pop"),
    );
    expect(local.siblingPairs).toContain("dream-pop|indie-rock");
  });

  it("builds directed influence and fusion links for the complete wheel", () => {
    const model = buildGenreWheelModel([
      node("rock", {
        top_level: true,
        influences_slugs: ["punk"],
      }),
      node("punk", {
        parent_slugs: ["rock"],
        influenced_by_slugs: ["rock"],
        fusion_genre_slugs: ["alternative"],
      }),
      node("alternative", {
        top_level: true,
        fusion_of_slugs: ["punk"],
      }),
      node("overlay", { origin: "overlay", top_level: true }),
    ]);

    expect(model.nodes.map((item) => item.slug)).toEqual([
      "rock",
      "alternative",
      "punk",
    ]);
    expect(model.semanticEdges).toEqual([
      { source: "punk", target: "alternative", type: "fusion" },
      { source: "rock", target: "punk", type: "influence" },
    ]);
  });

  it("lays out only core nodes and ignores missing parent and related references", () => {
    const model = buildGenreWheelModel([
      node("rock", { top_level: true }),
      node("indie-rock", {
        parent_slugs: ["rock", "missing-parent"],
        related_slugs: ["missing-related"],
      }),
      node("overlay", { origin: "overlay", top_level: true }),
    ]);

    expect(model.nodes.map((genre) => genre.slug)).toEqual([
      "rock",
      "indie-rock",
    ]);
    expect(model.positions.size).toBe(2);
    expect(model.parentEdges).toEqual([{ slug: "indie-rock", parent: "rock" }]);
    expect(model.relatedPairs).toEqual([]);
    expect(model.families).toBe(1);
  });

  it("keeps the website's curated family and subgenre order", () => {
    const model = buildGenreWheelModel([
      node("indie-rock", { parent_slugs: ["alternative"] }),
      node("metal", { top_level: true }),
      node("alternative", { top_level: true }),
      node("rock", { top_level: true }),
    ]);

    expect(model.nodes.map((genre) => genre.slug)).toEqual([
      "rock",
      "alternative",
      "metal",
      "indie-rock",
    ]);
    expect(model.positions.get("rock")?.angle).toBeLessThan(
      model.positions.get("alternative")!.angle,
    );
    expect(model.positions.get("alternative")?.angle).toBeLessThan(
      model.positions.get("metal")!.angle,
    );
  });

  it("breaks a cyclic parent chain deterministically and keeps each node visible", () => {
    const model = buildGenreWheelModel([
      node("a", { parent_slugs: ["b"] }),
      node("b", { parent_slugs: ["a"] }),
    ]);

    expect(model.positions.size).toBe(2);
    expect(
      new Set([...model.positions.values()].map((item) => item.ring)).size,
    ).toBe(1);
  });

  it("resolves inherited EQ paths through the nearest parent preset", () => {
    const parent = node("punk", {
      top_level: true,
      eq_gains: Array(10).fill(2),
      eq_preset_source: "direct",
    });
    const child = node("hardcore", {
      parent_slugs: ["punk"],
      eq_gains: Array(10).fill(1),
      eq_preset_source: "inherited",
      eq_preset_inherited_from: "punk",
    });

    expect(resolveGenreWheelEqPath(child, [parent, child])).toEqual([
      "hardcore",
      "punk",
    ]);
    expect(formatGenreWheelGain(2.4)).toBe("+2");
    expect(formatGenreWheelGain(-2.4)).toBe("−2");
    expect(formatGenreWheelGain(0.2)).toBe("0");
  });

  it("maps an overlay through intermediate overlay nodes to the nearest core genre", () => {
    const rock = node("rock", { top_level: true });
    const scene = node("regional-scene", {
      origin: "overlay",
      top_level: false,
      parent_slugs: ["rock"],
    });
    const importedTag = node("local-rock-scene", {
      name: "Local rock scene",
      origin: "overlay",
      top_level: false,
      parent_slugs: ["regional-scene"],
    });

    expect(resolveOverlayCoreTargets(importedTag, [rock, scene, importedTag])).toEqual([
      "rock",
    ]);
  });

  it("uses exact canonical aliases when an overlay has no graph links", () => {
    const rock = node("rock", { top_level: true, alias_names: ["rock music"] });
    const importedTag = node("rock-music", {
      name: "Rock Music",
      origin: "overlay",
      top_level: false,
    });

    expect(resolveOverlayCoreTargets(importedTag, [rock, importedTag])).toEqual([
      "rock",
    ]);
  });
});
