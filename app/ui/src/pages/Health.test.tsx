import { describe, expect, it } from "vitest";

import {
  fixAllMode,
  groupIssuesByArtist,
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
