import { describe, expect, it } from "vitest";

import {
  filterNetwork,
  labelVisible,
  mergeNetwork,
  neighborsOf,
  nodeRadius,
  type NetworkData,
} from "./network-model";

const data: NetworkData = {
  nodes: [
    { id: "Pixies", group: 0, in_library: true, score: 1 },
    { id: "Breeders", group: 1, in_library: true, score: 0.9 },
    { id: "Belly", group: 1, in_library: false, score: 0.5 },
  ],
  links: [
    { source: "Pixies", target: "Breeders", value: 0.9 },
    { source: { id: "Pixies" }, target: { id: "Belly" }, value: 0.5 },
  ],
};

describe("network model", () => {
  it("merges an expansion without case duplicates and counts new artists", () => {
    const { data: merged, added } = mergeNetwork(data, {
      nodes: [
        { id: "breeders", group: 0, in_library: true, score: 1 },
        { id: "Amps", group: 1, in_library: false, score: 0.6 },
      ],
      links: [
        { source: "breeders", target: "Amps", value: 0.6 },
        { source: "Breeders", target: "pixies", value: 0.9 },
      ],
    });
    expect(added).toBe(1);
    expect(merged.nodes.map((node) => node.id)).toEqual([
      "Pixies",
      "Breeders",
      "Belly",
      "Amps",
    ]);
    expect(merged.links[merged.links.length - 1]).toEqual({
      source: "Breeders",
      target: "Amps",
      value: 0.6,
    });
    expect(merged.links).toHaveLength(3);
  });

  it("lists neighbours by similarity, resolving force-graph link objects", () => {
    expect(
      neighborsOf(data, "pixies").map(({ node, score }) => [node.id, score]),
    ).toEqual([
      ["Breeders", 0.9],
      ["Belly", 0.5],
    ]);
  });

  it("filters by status while pinning the center and selection", () => {
    const missing = filterNetwork(data, "missing", new Set(), ["Pixies"]);
    expect(missing.nodes.map((node) => node.id)).toEqual(["Pixies", "Belly"]);
    expect(missing.links).toHaveLength(1);
    const shows = filterNetwork(data, "shows", new Set(["breeders"]), [
      "Pixies",
    ]);
    expect(shows.nodes.map((node) => node.id)).toEqual(["Pixies", "Breeders"]);
  });

  it("labels the center, the hovered artist, the focused neighbourhood and everything when zoomed in", () => {
    const [pixies, breeders, belly] = data.nodes;
    const base = {
      center: "Pixies",
      scale: 1,
      selected: null,
      hovered: null,
      focus: new Set<string>(),
    };
    expect(labelVisible({ ...base, node: pixies! })).toBe(true);
    expect(labelVisible({ ...base, node: breeders! })).toBe(false);
    expect(labelVisible({ ...base, node: belly!, hovered: "belly" })).toBe(
      true,
    );
    expect(
      labelVisible({
        ...base,
        node: breeders!,
        selected: "Breeders",
        focus: new Set(["breeders"]),
      }),
    ).toBe(true);
    expect(labelVisible({ ...base, node: belly!, scale: 2 })).toBe(true);
  });

  it("sizes the center and library artists above external ones", () => {
    const [pixies, breeders, belly] = data.nodes;
    expect(nodeRadius(pixies!, true)).toBe(22);
    expect(nodeRadius(breeders!, false)).toBeCloseTo(14.2);
    expect(nodeRadius(belly!, false)).toBe(9);
  });
});
