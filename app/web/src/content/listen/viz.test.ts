import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  readJavaConstants,
  readPyDict,
  readTsNumberArrays,
  repoFile,
} from "../../lib/source-drift";
import { EQ_BANDS, EQ_GAIN_MAX, EQ_PRESETS, MIX, MOODS } from "./viz";

describe("viz data copied from the apps", () => {
  it("keeps every EQ preset identical to Listen's equalizer", () => {
    const source = readFileSync(
      repoFile("app/listen/src/lib/equalizer.ts"),
      "utf8",
    );
    const block = source.slice(source.indexOf("export const EQ_PRESETS"));

    expect(EQ_PRESETS).toEqual(
      readTsNumberArrays(block.slice(0, block.indexOf("};"))),
    );
  });

  it("keeps the band labels and gain range of Listen's equalizer", () => {
    const source = readFileSync(
      repoFile("app/listen/src/lib/equalizer.ts"),
      "utf8",
    );
    const labels = [...source.matchAll(/label: "([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect([...EQ_BANDS]).toEqual(labels);
    expect(source).toContain(`EQ_GAIN_MAX = ${EQ_GAIN_MAX};`);
  });

  it("keeps every mood threshold identical to the backend mood presets", () => {
    const source = readFileSync(
      repoFile("app/crate/api/browse_media.py"),
      "utf8",
    );
    const presets = readPyDict(source, "MOOD_PRESETS");

    expect(
      Object.fromEntries(MOODS.map((mood) => [mood.id, mood.filters])),
    ).toEqual(presets);
  });

  it("keeps the Smart Mix engine figures identical to the Android player", () => {
    const java = (name: string) =>
      readJavaConstants(
        readFileSync(
          repoFile(
            `app/listen/android/app/src/main/java/app/cratemusic/crate/${name}.java`,
          ),
          "utf8",
        ),
      );
    const controller = java("NativeMixController");
    const plan = java("NativeTransitionPlan");
    const bass = java("BassHandoffFilter");
    const bus = java("PcmBusMixer");
    const service = java("CrateNativePlaybackService");

    expect(MIX.prerollMs).toBe(controller.PREROLL_MS);
    expect(MIX.lockWindowMs).toBe(controller.MAX_START_PHASE_ERROR_MS);
    expect(MIX.tempoRestoreMs).toBe(service.TEMPO_RESTORE_MS);
    expect(MIX.tempoRatio.min).toBeCloseTo(plan.MIN_TEMPO_RATIO!, 6);
    expect(MIX.tempoRatio.max).toBeCloseTo(plan.MAX_TEMPO_RATIO!, 6);
    expect(MIX.bus).toEqual({
      sampleRate: bus.SAMPLE_RATE,
      blockFrames: bus.BLOCK_FRAMES,
    });
    expect(MIX.bass).toEqual({
      shelfHz: bass.SHELF_HZ,
      cutDb: bass.CUT_DB,
      swapFraction: bass.SWAP_FRACTION,
    });
  });

  it("keeps the Smart Mix planner limits identical to the server policy", () => {
    const source = readFileSync(
      repoFile("app/crate/smart_mix/policy.py"),
      "utf8",
    );
    const field = (name: string) =>
      Number(
        source
          .match(new RegExp(`^\\s+${name}: \\w+ = (-?[\\d_.]+)$`, "m"))?.[1]
          ?.replace(/_/g, ""),
      );

    expect(MIX.planner).toEqual({
      maxTempoChange: field("maximum_tempo_adjustment"),
      minBeatmatchBeats: field("minimum_beatmatch_beats"),
      maxLoudnessDb: field("max_loudness_adjustment_db"),
      truePeakDbtp: field("combined_true_peak_ceiling_dbfs"),
      minTransitionMs: field("minimum_transition_ms"),
      maxTransitionMs: field("maximum_transition_ms"),
    });
    expect(MIX.beats).toBeGreaterThanOrEqual(MIX.planner.minBeatmatchBeats);
    expect(Math.abs(MIX.a.bpm / MIX.b.bpm - 1)).toBeLessThanOrEqual(
      MIX.planner.maxTempoChange,
    );
  });
});
