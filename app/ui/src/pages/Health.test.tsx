import { describe, expect, it } from "vitest";

import {
  fixAllMode,
  groupIssuesByArtist,
  groupHealthIssues,
  latestRepairSummary,
  type RepairCatalogEntry,
} from "./Health";

function issue(
  id: number,
  details: Record<string, unknown>,
  artist_id: number | null = null,
) {
  return {
    id,
    check_type: "duplicate_tracks",
    severity: "medium",
    description: `issue ${id}`,
    details_json: details,
    auto_fixable: true,
    status: "open",
    created_at: "2026-10-09T00:00:00Z",
    artist_id,
  };
}

describe("groupIssuesByArtist", () => {
  it("groups by artist id, largest group first, unlinked issues last", () => {
    const groups = groupIssuesByArtist([
      issue(1, { artist: "Converge" }, 4),
      issue(2, { path: "/music/loose" }),
      issue(3, { artist: "Birds In Row" }, 9),
      issue(4, { artist: "Birds In Row" }, 9),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["id:9", "id:4", "none"]);
    expect(groups[0]).toMatchObject({
      artistId: 9,
      artistName: "Birds In Row",
    });
    expect(groups[0]!.items.map((item) => item.id)).toEqual([3, 4]);
  });

  it("falls back to the tag artist name when there is no artist id", () => {
    const [group] = groupIssuesByArtist([issue(5, { db_artist: "Converge" })]);

    expect(group).toMatchObject({
      key: "name:Converge",
      artistId: null,
      artistName: "Converge",
    });
  });
});

function catalogEntry(
  overrides: Partial<RepairCatalogEntry>,
): RepairCatalogEntry {
  return {
    check_type: "artist_layout_fix",
    scanner_method: "_check_artist_layout_fix",
    fixer_method: "_fix_artist_layout",
    support: "automatic",
    risk: "caution",
    scope: "hybrid",
    requires_confirmation: true,
    supports_batch: true,
    supports_artist_scope: true,
    supports_global_scope: false,
    supports_bulk_fix: false,
    auto_fixable: true,
    ...overrides,
  };
}

describe("fixAllMode", () => {
  it("offers a confirmed bulk fix for artist-batched repairs", () => {
    expect(fixAllMode(catalogEntry({ supports_bulk_fix: true }), 172)).toBe(
      "bulk",
    );
  });

  it("keeps global repairs as a direct fix", () => {
    expect(fixAllMode(catalogEntry({ supports_global_scope: true }), 3)).toBe(
      "global",
    );
  });

  it("hides fix all for artist-only, manual or empty groups", () => {
    expect(fixAllMode(catalogEntry({}), 5)).toBe("none");
    expect(
      fixAllMode(
        catalogEntry({ supports_bulk_fix: true, auto_fixable: false }),
        5,
      ),
    ).toBe("none");
    expect(fixAllMode(catalogEntry({ supports_bulk_fix: true }), 0)).toBe(
      "none",
    );
    expect(fixAllMode(undefined, 5)).toBe("none");
  });
});

describe("Health issue queue", () => {
  it("prioritises a check by its worst loaded issue without losing cases", () => {
    const groups = groupHealthIssues([
      { ...issue(1, {}), check_type: "z", severity: "low" },
      { ...issue(2, {}), check_type: "a", severity: "medium" },
      { ...issue(3, {}), check_type: "z", severity: "critical" },
    ]);
    expect(groups.map(({ check, severity }) => [check, severity])).toEqual([
      ["z", "critical"],
      ["a", "medium"],
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual([1, 3]);
  });
  it("orders equal severities consistently and preserves unknown check/severity values", () => {
    const groups = groupHealthIssues([
      { ...issue(1, {}), check_type: "z" },
      { ...issue(2, {}), check_type: "a" },
      { ...issue(3, {}), check_type: "future_check", severity: "future_level" },
    ]);
    expect(groups.map(({ check, severity }) => [check, severity])).toEqual([
      ["a", "medium"],
      ["z", "medium"],
      ["future_check", "future_level"],
    ]);
    expect(groupHealthIssues([])).toEqual([]);
  });
});

describe("recorded Health task results", () => {
  it.each([
    ["health_check", { issue_count: 0 }, "0 issues found"],
    ["health_check", { issue_count: 1 }, "1 issue found"],
    ["health_check", {}, "Result details unavailable"],
    ["health_check", { issue_count: null }, "Result details unavailable"],
    ["health_check", { issue_count: -1 }, "Result details unavailable"],
    ["health_check", { issue_count: true }, "Result details unavailable"],
    ["health_check", { issue_count: "4" }, "Result details unavailable"],
    ["repair", { summary: { applied: 0 } }, "0 applied"],
    ["repair", { summary: { failed: 2 } }, "2 failed"],
    [
      "repair",
      { revalidation: { issue_count: 3 } },
      "3 open after revalidation",
    ],
    ["repair", { summary: { applied: -2 } }, "Result details unavailable"],
    [
      "repair",
      {
        summary: { applied: 1, skipped: 0, unsupported: 2 },
        revalidation: { issue_count: 0 },
      },
      "1 applied, 2 manual, 0 open after revalidation",
    ],
    ["fix_artist", { albums_fixed: 2 }, "2 albums fixed"],
    ["fix_artist", {}, "Result details unavailable"],
  ])("uses explicit counters for %s %j", (type, result, expected) => {
    expect(latestRepairSummary({ type, result, status: "completed" })).toBe(
      expected,
    );
  });
  it("retains an actual error and does not invent a result for an absent task", () => {
    expect(
      latestRepairSummary({
        type: "repair",
        status: "failed",
        error: "Disk unavailable",
      }),
    ).toBe("Disk unavailable");
    expect(latestRepairSummary(null)).toBe(
      "No repair or health runs recorded yet.",
    );
  });
});
