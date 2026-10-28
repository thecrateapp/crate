import { describe, expect, it } from "vitest";
import { GENRES } from "../../content/admin/viz";
import {
  buildTaxonomy,
  genreRoute,
  radialLayout,
  resolveEq,
} from "./taxonomy-math";

const graph = buildTaxonomy(GENRES);

describe("resolveEq", () => {
  it("uses a genre's own preset first", () => {
    expect(resolveEq(graph, "rock")).toEqual({
      preset: "rock",
      source: "direct",
      from: "rock",
      path: ["rock"],
    });
  });

  it("walks up the parents to the nearest genre with a preset, like resolve_genre_eq_preset", () => {
    expect(resolveEq(graph, "powerviolence")).toEqual({
      preset: "hardcore",
      source: "inherited",
      from: "hardcore-punk",
      path: ["powerviolence", "hardcore-punk"],
    });
    expect(resolveEq(graph, "funk")?.from).toBe("soul");
    expect(resolveEq(graph, "crust-punk")?.from).toBe("punk");
    expect(resolveEq(graph, "thrash-metal")?.from).toBe("metal");
  });

  it("returns null for an unknown genre", () => {
    expect(resolveEq(graph, "vaporwave")).toBeNull();
  });
});

describe("genreRoute", () => {
  it("finds the same scene routes as build_scene_genre_route", () => {
    expect(genreRoute(graph, "shoegaze", "black-metal")).toEqual([
      "shoegaze",
      "alternative",
      "nu-metal",
      "metal",
      "black-metal",
    ]);
    expect(genreRoute(graph, "jazz", "techno")).toEqual([
      "jazz",
      "soul",
      "funk",
      "electronic",
      "techno",
    ]);
    expect(genreRoute(graph, "folk", "post-metal")).toEqual([
      "folk",
      "country",
      "rock",
      "psychedelic-rock",
      "doom-metal",
      "metal",
      "post-metal",
    ]);
    expect(genreRoute(graph, "trip-hop", "doom-metal")).toEqual([
      "trip-hop",
      "electronic",
      "industrial",
      "industrial-metal",
      "metal",
      "doom-metal",
    ]);
  });

  it("returns the single genre when start and end are the same", () => {
    expect(genreRoute(graph, "punk", "punk")).toEqual(["punk"]);
  });
});

describe("radialLayout", () => {
  const layout = radialLayout(graph);

  it("places families on the inner ring and descendants further out", () => {
    expect(layout.get("metal")?.ring).toBe(1);
    expect(layout.get("black-metal")?.ring).toBe(2);
    expect(layout.get("powerviolence")?.ring).toBe(3);
    expect(layout.size).toBe(61);
  });

  it("keeps every child inside its family's sector", () => {
    const metal = layout.get("metal")!;
    for (const child of graph.children.get("metal") ?? []) {
      const angle = layout.get(child)!.angle;
      expect(angle).toBeGreaterThanOrEqual(metal.from);
      expect(angle).toBeLessThanOrEqual(metal.to);
    }
  });

  it("spreads angles over the whole circle without overlaps on a ring", () => {
    const ring2 = [...layout.values()]
      .filter((node) => node.ring === 2)
      .map((node) => node.angle);
    expect(new Set(ring2.map((angle) => angle.toFixed(4))).size).toBe(
      ring2.length,
    );
    for (const node of layout.values()) {
      expect(node.angle).toBeGreaterThanOrEqual(0);
      expect(node.angle).toBeLessThan(Math.PI * 2);
    }
  });
});
