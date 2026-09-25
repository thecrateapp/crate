import { describe, expect, it } from "vitest";

import { describeTaskResult, type TaskResultLike } from "./task-results";

function task(overrides: Partial<TaskResultLike> = {}): TaskResultLike {
  return {
    type: "unknown",
    status: "completed",
    error: null,
    result: null,
    ...overrides,
  };
}

describe("task result descriptions", () => {
  it("prefers task errors and truncates long messages", () => {
    expect(describeTaskResult(task({ error: "failed" }))).toBe("failed");
    expect(describeTaskResult(task({ error: "x".repeat(121) }))).toBe(
      `${"x".repeat(120)}…`,
    );
  });

  it("describes missing results according to task status", () => {
    expect(describeTaskResult(task())).toBe("Completed");
    expect(describeTaskResult(task({ status: "running" }))).toBe("");
  });

  it("summarizes process steps while counting failed and skipped steps", () => {
    expect(
      describeTaskResult(
        task({
          type: "process_new_content",
          result: {
            steps: {
              download: "done",
              analyze: "failed",
              alreadyPresent: false,
              metadata: null,
            },
          },
        }),
      ),
    ).toBe("2 steps done, 1 failed");
  });

  it.each([
    ["enrich_artist", { skipped: true }, "Skipped (recently enriched)"],
    ["enrich_artist", {}, "Artist enriched"],
    [
      "enrich_artists",
      { enriched: 2, skipped: 1, failed: 0 },
      "2 enriched, 1 skipped",
    ],
    ["analyze_all", { analyzed: 3, failed: 1 }, "3 tracks analyzed, 1 failed"],
    ["compute_bliss", { analyzed: 4 }, "4 tracks vectorized"],
    ["compute_popularity", { albums: 2, tracks: 5 }, "2 albums, 5 tracks"],
    ["health_check", { issue_count: 2 }, "2 issues found"],
    [
      "repair",
      {
        summary: { applied: 2, skipped: 1, failed: 1, unsupported: 1 },
        revalidation: { issue_count: 3 },
        fs_changed: true,
      },
      "2 applied, 1 skipped, 1 failed, 1 manual, 3 open after revalidation (filesystem modified)",
    ],
    [
      "fix_artist",
      { albums_fixed: 2, synced_tracks: 4 },
      "2 albums fixed, 4 tracks synced",
    ],
    [
      "library_pipeline",
      { artists_added: 1, tracks_total: 20 },
      "+1 artists, 20 tracks",
    ],
    ["match_apply", { updated: 2, total: 5 }, "2/5 tracks tagged"],
    ["delete_album", {}, "Deleted"],
    ["compute_analytics", {}, "Analytics computed"],
    ["tidal_download", { error: "network unavailable" }, "network unavailable"],
  ])("formats %s task results", (type, result, expected) => {
    expect(
      describeTaskResult(
        task({
          type: String(type),
          result: result as Record<string, unknown>,
        }),
      ),
    ).toBe(expected);
  });

  it("falls back to a compact description for unknown result shapes", () => {
    expect(describeTaskResult(task({ result: { id: 1, state: "ok" } }))).toBe(
      'id: 1, state: "ok"',
    );
    expect(
      describeTaskResult(
        task({ result: { one: 1, two: 2, three: 3, four: 4 } }),
      ),
    ).toBe("4 fields");
  });
});
