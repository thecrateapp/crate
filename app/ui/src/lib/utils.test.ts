import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatSize,
  formatBitrate,
  formatNumber,
  formatCompact,
  formatDurationMs,
  encPath,
  timeAgo,
} from "./utils";

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(125)).toBe("2:05");
  });

  it("formats single digit seconds", () => {
    expect(formatDuration(5)).toBe("0:05");
  });
});

describe("formatSize", () => {
  it("formats MB", () => {
    expect(formatSize(500)).toBe("500 MB");
  });

  it("formats GB", () => {
    expect(formatSize(2048)).toBe("2.0 GB");
  });
});

describe("formatBitrate", () => {
  it("formats kbps", () => {
    expect(formatBitrate(320)).toBe("320k");
  });

  it("returns dash for null", () => {
    expect(formatBitrate(null)).toBe("-");
  });
});

describe("formatNumber", () => {
  it("formats with locale", () => {
    expect(formatNumber(1000)).toMatch(/1[,.]?000/);
  });

  it("returns 0 for undefined", () => {
    expect(formatNumber(undefined as unknown as number)).toBe("0");
  });
});

describe("formatCompact", () => {
  it("formats thousands", () => {
    expect(formatCompact(1500)).toBe("1.5K");
  });

  it("formats millions", () => {
    expect(formatCompact(2500000)).toBe("2.5M");
  });

  it("formats billions", () => {
    expect(formatCompact(1500000000)).toBe("1.5B");
  });

  it("returns string for small numbers", () => {
    expect(formatCompact(42)).toBe("42");
  });
});

describe("formatDurationMs", () => {
  it("formats milliseconds", () => {
    expect(formatDurationMs(125000)).toBe("2:05");
  });
});

describe("encPath", () => {
  it("encodes string", () => {
    expect(encPath("hello world")).toBe("hello%20world");
  });
});

describe("timeAgo", () => {
  it("returns just now for recent", () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const date = new Date(Date.now() - 120000).toISOString();
    expect(timeAgo(date)).toBe("2m ago");
  });

  it("returns hours ago", () => {
    const date = new Date(Date.now() - 7200000).toISOString();
    expect(timeAgo(date)).toBe("2h ago");
  });

  it("returns days ago", () => {
    const date = new Date(Date.now() - 172800000).toISOString();
    expect(timeAgo(date)).toBe("2d ago");
  });

  it("returns date for old timestamps", () => {
    const date = new Date("2020-01-01").toISOString();
    expect(timeAgo(date)).toContain("2020");
  });
});
