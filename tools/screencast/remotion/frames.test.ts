import { describe, expect, it } from "vitest";
import { frameAt } from "./frames";

describe("frameAt", () => {
  const frames = [
    { file: "00000.png", t: 0.1 },
    { file: "00001.png", t: 0.5 },
    { file: "00002.png", t: 1.2 },
  ];

  it("shows the first frame before the capture starts", () => {
    expect(frameAt(frames, 0)).toBe("00000.png");
  });

  it("shows the latest frame captured at or before the time", () => {
    expect(frameAt(frames, 0.5)).toBe("00001.png");
    expect(frameAt(frames, 1.19)).toBe("00001.png");
    expect(frameAt(frames, 9)).toBe("00002.png");
  });

  it("returns null without frames", () => {
    expect(frameAt([], 1)).toBeNull();
  });
});
