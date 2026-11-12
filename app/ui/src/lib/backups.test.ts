import { describe, expect, it } from "vitest";

import {
  copiesKept,
  formatAgo,
  formatBackupBytes,
  formatSeconds,
  keptDays,
  kindBadge,
  policyLine,
  rcloneDriveAuthorizeCommand,
  reachText,
} from "./backups";

const NOW = Date.parse("2026-11-10T16:50:00Z");

describe("backups helpers", () => {
  it("formats ages, sizes and durations like the approved mockups", () => {
    expect(formatAgo("2026-11-10T16:34:00Z", NOW)).toBe("16 min ago");
    expect(formatAgo("2026-11-10T03:37:00Z", NOW)).toBe("13 h ago");
    expect(formatAgo("2026-11-09T03:41:00Z", NOW)).toBe("1 d 13 h ago");
    expect(formatAgo("2026-10-07T03:36:00Z", NOW)).toBe("34 d ago");
    expect(formatAgo("2026-11-08T05:23:00Z", NOW)).toBe("2 d ago");
    expect(formatAgo(null, NOW)).toBe("Never");
    expect(formatBackupBytes(8.1 * 1024 ** 3)).toBe("8.1 GB");
    expect(formatBackupBytes(1.38 * 1024 ** 3)).toBe("1.38 GB");
    expect(formatBackupBytes(17.6 * 1024 ** 3)).toBe("17.6 GB");
    expect(formatBackupBytes(null)).toBe("—");
    expect(formatSeconds(38)).toBe("38 s");
    expect(formatSeconds(221)).toBe("3 min 41 s");
    expect(formatSeconds(3900)).toBe("1 h 05 min");
  });

  it("names the S3 provider from its endpoint", () => {
    expect(
      kindBadge({
        kind: "s3",
        config: { endpoint: "https://abc.r2.cloudflarestorage.com" },
      }),
    ).toBe("S3 · Cloudflare R2");
    expect(
      kindBadge({ kind: "s3", config: { endpoint: "https://s3.example.net" } }),
    ).toBe("S3");
    expect(kindBadge({ kind: "local", config: {} })).toBe("Local");
    expect(kindBadge({ kind: "sftp", config: {} })).toBe("SFTP");
  });

  it("builds the rclone authorize blob for drive.file, unpadded base64url", () => {
    const command = rcloneDriveAuthorizeCommand(
      "id.apps.googleusercontent.com",
      "s3cr?t",
    );
    const blob = command.match(
      /^rclone authorize drive "([A-Za-z0-9_-]+)"$/,
    )![1]!;
    const json = atob(blob.replace(/-/g, "+").replace(/_/g, "/"));
    expect(JSON.parse(json)).toEqual({
      client_id: "id.apps.googleusercontent.com",
      client_secret: "s3cr?t",
      scope: "drive.file",
    });
    expect(Object.keys(JSON.parse(json))).toEqual([
      "client_id",
      "client_secret",
      "scope",
    ]);
  });

  it("estimates retention", () => {
    const counts = { keep_daily: 7, keep_weekly: 4, keep_monthly: 3 };
    expect(copiesKept(counts)).toBe(14);
    expect(copiesKept(counts, ["weekly", "monthly"])).toBe(7);
    expect(reachText(counts)).toBe("about 3 months");
    const kept = keptDays(counts, new Date(2026, 10, 10));
    expect([...kept.values()].filter((t) => t === "daily")).toHaveLength(7);
    expect(kept.get(9)).toBe("weekly"); // Sunday 1 Nov
    expect(kept.get(10)).toBe("monthly"); // Saturday 31 Oct
  });

  it("summarises a policy schedule", () => {
    expect(
      policyLine({
        schedule_kind: "daily",
        daily_at: "03:30",
        interval_hours: null,
        destinations: { a: ["daily"], b: ["weekly"] },
      }),
    ).toBe("Daily 03:30 · 2 destinations");
    expect(
      policyLine({
        schedule_kind: "manual",
        daily_at: null,
        interval_hours: null,
        destinations: { a: ["monthly"] },
      }),
    ).toBe("Manual only · 1 destination");
  });
});
