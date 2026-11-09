// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { milestones, timelineAsOf } from "./engineering-timeline";

describe("engineering timeline", () => {
  it("keeps historical milestones unique, dated and in chronological periods", () => {
    expect(milestones.length).toBeGreaterThanOrEqual(30);
    expect(new Set(milestones.map((item) => item.id)).size).toBe(
      milestones.length,
    );
    let previousDate = "";
    let previousEra = "";
    const closedEras = new Set<string>();
    for (const item of milestones) {
      expect(item.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(
        new Date(`${item.date}T00:00:00Z`).toISOString().slice(0, 10),
      ).toBe(item.date);
      expect(
        item.date >= previousDate && item.date <= timelineAsOf,
        item.id,
      ).toBe(true);
      if (item.era !== previousEra) {
        expect(closedEras.has(item.era), item.id).toBe(false);
        if (previousEra) closedEras.add(previousEra);
        previousEra = item.era;
      }
      previousDate = item.date;
    }
  });

  it("pins the evidence to historical commits", () => {
    for (const item of milestones) {
      expect(item.source, item.id).toMatch(
        /^https:\/\/github\.com\/thecrateapp\/crate\/commit\/[a-f0-9]{40}$/,
      );
    }
  });

  it("only links to articles that exist, with the correct draft status", () => {
    for (const item of milestones) {
      if (item.status === "planned") {
        expect(item.href, item.id).toBeUndefined();
        continue;
      }
      expect(item.href, item.id).toMatch(/^\/blog\/[a-z0-9-]+$/);
      const slug = item.href!.slice("/blog/".length);
      const path = fileURLToPath(
        new URL(`../content/blog/${slug}.md`, import.meta.url),
      );
      expect(existsSync(path), item.id).toBe(true);
      expect(
        /^draft:\s*true\s*$/m.test(readFileSync(path, "utf8")),
        item.id,
      ).toBe(item.status === "draft");
      if (item.chapter) {
        const part = readFileSync(path, "utf8").match(
          /^  part:\s*(\d+)$/m,
        )?.[1];
        expect(
          Number(part),
          `${item.id} must name its destination chapter`,
        ).toBe(item.chapter);
      }
    }
  });

  it("uses recognised capabilities without dropping them at a later milestone", () => {
    const allowed = new Set([
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ]);
    let previous: string[] = [];
    for (const item of milestones) {
      expect(new Set(item.systems).size, item.id).toBe(item.systems.length);
      for (const system of item.systems)
        expect(allowed.has(system), item.id).toBe(true);
      for (const system of previous)
        expect(item.systems, item.id).toContain(system);
      previous = item.systems;
    }
  });
});
