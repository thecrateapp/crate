import { describe, expect, it } from "vitest";
import { schedulePool } from "./pool-math";

describe("schedulePool", () => {
  it("runs jobs in submission order on the first free worker, like a thread pool", () => {
    const jobs = [
      { id: "a", duration: 2 },
      { id: "b", duration: 1 },
      { id: "c", duration: 3 },
      { id: "d", duration: 1 },
      { id: "e", duration: 1 },
    ];

    expect(schedulePool(jobs, 2)).toEqual([
      { id: "a", worker: 0, start: 0, end: 2 },
      { id: "b", worker: 1, start: 0, end: 1 },
      { id: "c", worker: 1, start: 1, end: 4 },
      { id: "d", worker: 0, start: 2, end: 3 },
      { id: "e", worker: 0, start: 3, end: 4 },
    ]);
  });

  it("never uses more workers than there are jobs", () => {
    expect(schedulePool([{ id: "a", duration: 1 }], 3)).toEqual([
      { id: "a", worker: 0, start: 0, end: 1 },
    ]);
  });
});
