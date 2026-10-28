import { describe, expect, it } from "vitest";
import { countAt, formatCount } from "./counter";

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(48213)).toBe("48,213");
  });

  it("rounds to a whole number", () => {
    expect(formatCount(120.6)).toBe("121");
  });

  it("abbreviates thousands when compact", () => {
    expect(formatCount(4400, true)).toBe("4.4K");
    expect(formatCount(3700, true)).toBe("3.7K");
  });

  it("keeps small numbers whole when compact", () => {
    expect(formatCount(255, true)).toBe("255");
  });
});

describe("countAt", () => {
  it("starts at zero and lands on the target", () => {
    expect(countAt(121, 0)).toBe(0);
    expect(countAt(121, 1)).toBe(121);
  });

  it("eases out, covering more than half the distance by the midpoint", () => {
    expect(countAt(100, 0.5)).toBeGreaterThan(50);
    expect(countAt(100, 0.5)).toBeLessThan(100);
  });

  it("clamps progress outside 0..1", () => {
    expect(countAt(108, -1)).toBe(0);
    expect(countAt(108, 2)).toBe(108);
  });
});
