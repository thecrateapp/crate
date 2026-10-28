import { describe, expect, it } from "vitest";
import { adminScene } from "./admin";

const now = new Date("2026-10-26T21:00:00Z");

describe("adminScene", () => {
  it.each([
    { elapsed: 0, analysed: 0, bliss: "pending", tidal: "downloading" },
    { elapsed: 4.5, analysed: 5, bliss: "running", tidal: "downloading" },
    { elapsed: 6, analysed: 6, bliss: "running", tidal: "processing" },
    { elapsed: 30, analysed: 8, bliss: "running", tidal: "processing" },
  ])(
    "at $elapsed s analyses $analysed tracks",
    ({ elapsed, analysed, bliss, tidal }) => {
      const scene = adminScene(elapsed, now);
      const analysis = scene.running.find(
        (task) => task.type === "analyze_album_full",
      );

      expect(analysis?.progress.done).toBe(analysed);
      expect(scene.analysis.pending).toBe(8 - analysed);
      expect(
        [...scene.running, ...scene.pending].find(
          (task) => task.type === "compute_bliss",
        )?.status,
      ).toBe(bliss);
      expect(scene.tidal[0].status).toBe(tidal);
    },
  );

  it("counts every task in its pool", () => {
    const scene = adminScene(5, now);
    const running = Object.values(scene.queueBreakdown.running).reduce(
      (sum, value) => sum + value,
      0,
    );
    const pending = Object.values(scene.queueBreakdown.pending).reduce(
      (sum, value) => sum + value,
      0,
    );

    expect(running).toBe(scene.running.length);
    expect(pending).toBe(scene.pending.length);
  });

  it("keeps Soulseek progress between 0 and 100 and marks finished files", () => {
    for (const elapsed of [0, 3, 12, 60]) {
      for (const file of adminScene(elapsed, now).soulseek) {
        expect(file.progress).toBeGreaterThanOrEqual(0);
        expect(file.progress).toBeLessThanOrEqual(100);
        expect(file.status === "Completed, Succeeded").toBe(
          file.progress === 100,
        );
      }
    }
  });

  it("never runs a task backwards in time", () => {
    const early = adminScene(2, now).running.find(
      (task) => task.type === "analyze_album_full",
    );
    const late = adminScene(5, now).running.find(
      (task) => task.type === "analyze_album_full",
    );

    expect(late!.progress.done).toBeGreaterThanOrEqual(early!.progress.done);
  });
});
