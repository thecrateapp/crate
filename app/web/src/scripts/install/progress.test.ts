import { describe, expect, it } from "vitest";
import { activeStep, railProgress } from "./progress";

const steps = [
  { top: 100, bottom: 400 },
  { top: 400, bottom: 700 },
  { top: 700, bottom: 1000 },
];

describe("activeStep", () => {
  it("is -1 before the first step reaches the probe line", () => {
    expect(activeStep(steps, 50)).toBe(-1);
  });

  it("is the last step whose top has crossed the probe line", () => {
    expect(activeStep(steps, 100)).toBe(0);
    expect(activeStep(steps, 650)).toBe(1);
    expect(activeStep(steps, 5000)).toBe(2);
  });
});

describe("railProgress", () => {
  it("fills the rail from 0 to 1 as the probe moves through it", () => {
    const rail = { top: 100, bottom: 1100 };
    expect(railProgress(rail, 0)).toBe(0);
    expect(railProgress(rail, 600)).toBe(0.5);
    expect(railProgress(rail, 2000)).toBe(1);
  });

  it("stays empty for a rail without height", () => {
    expect(railProgress({ top: 10, bottom: 10 }, 50)).toBe(0);
  });
});
