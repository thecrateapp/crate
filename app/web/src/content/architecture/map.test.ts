import { describe, expect, it } from "vitest";
import { routeEdges } from "../../lib/system-map";
import { architecture } from "./en";
import { edges, nodes } from "./map";

const ids = new Set(nodes.map((node) => node.id));

describe("system map data", () => {
  it("connects only nodes that exist", () => {
    for (const edge of edges) {
      expect(ids.has(edge.from), edge.id).toBe(true);
      expect(ids.has(edge.to), edge.id).toBe(true);
    }
  });

  it("gives every node a unique id", () => {
    expect(ids.size).toBe(nodes.length);
  });

  it("resolves every trace step to edges drawn in both layouts", () => {
    const traceEdges = edges.filter((edge) => !edge.only);
    for (const step of architecture.trace) {
      expect(
        () => routeEdges(step.route, traceEdges),
        step.title,
      ).not.toThrow();
      for (const id of step.route) {
        const node = nodes.find((candidate) => candidate.id === id);
        expect(node?.inTrace, id).not.toBe(false);
      }
    }
  });
});
