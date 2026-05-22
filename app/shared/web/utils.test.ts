import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encPath,
  formatBadgeClass,
  formatBitrate,
  formatCompact,
  formatDuration,
  formatDurationMs,
  formatNumber,
  formatSize,
  timeAgo,
} from "./utils";

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(61)).toBe("1:01");
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("pads seconds to two digits", () => {
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(65)).toBe("1:05");
  });
});

describe("formatSize", () => {
  it("formats megabytes", () => {
    expect(formatSize(0)).toBe("0 MB");
    expect(formatSize(500)).toBe("500 MB");
  });

  it("converts to gigabytes above 1024 MB", () => {
    expect(formatSize(1024)).toBe("1.0 GB");
    expect(formatSize(2048)).toBe("2.0 GB");
    expect(formatSize(1536)).toBe("1.5 GB");
  });
});

describe("formatBitrate", () => {
  it("returns dash for falsy values", () => {
    expect(formatBitrate(null)).toBe("-");
    expect(formatBitrate(0)).toBe("-");
  });

  it("appends k suffix", () => {
    expect(formatBitrate(320)).toBe("320k");
    expect(formatBitrate(1411)).toBe("1411k");
  });
});

describe("formatNumber", () => {
  it("returns string representation", () => {
    expect(typeof formatNumber(1000)).toBe("string");
    expect(formatNumber(42)).toBe("42");
  });

  it("handles falsy as 0", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatCompact", () => {
  it("formats billions", () => {
    expect(formatCompact(1_500_000_000)).toBe("1.5B");
  });

  it("formats millions", () => {
    expect(formatCompact(2_500_000)).toBe("2.5M");
  });

  it("formats thousands", () => {
    expect(formatCompact(4_200)).toBe("4.2K");
  });

  it("returns raw number for values under 1000", () => {
    expect(formatCompact(500)).toBe("500");
    expect(formatCompact(0)).toBe("0");
  });
});

describe("formatDurationMs", () => {
  it("converts milliseconds to m:ss", () => {
    expect(formatDurationMs(0)).toBe("0:00");
    expect(formatDurationMs(5000)).toBe("0:05");
    expect(formatDurationMs(65000)).toBe("1:05");
    expect(formatDurationMs(3661000)).toBe("61:01");
  });
});

describe("encPath", () => {
  it("encodes URI components", () => {
    expect(encPath("foo")).toBe("foo");
    expect(encPath("foo bar")).toBe("foo%20bar");
    expect(encPath("artist/album")).toBe("artist%2Falbum");
  });
});

describe("formatBadgeClass", () => {
  it("returns badge CSS classes", () => {
    const result = formatBadgeClass();
    expect(result).toContain("inline-flex");
    expect(result).toContain("items-center");
    expect(result).toContain("rounded-md");
  });
});

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 60 seconds', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(timeAgo(new Date(now - 30_000).toISOString())).toBe("just now");
  });

  it("returns minutes ago", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(timeAgo(new Date(now - 120_000).toISOString())).toBe("2m ago");
  });

  it("returns hours ago", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(timeAgo(new Date(now - 7_200_000).toISOString())).toBe("2h ago");
  });

  it("returns days ago", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(timeAgo(new Date(now - 172_800_000).toISOString())).toBe("2d ago");
  });

  it("returns date string for older dates", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const result = timeAgo(new Date(now - 30 * 86_400_000).toISOString());
    expect(result).toContain("/");
  });
});
