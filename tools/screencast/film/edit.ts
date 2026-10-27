import { barTime, beatLength, type BeatGrid } from "./grid";
import type { Device, Storyboard } from "./storyboard";

export interface Source {
  take: string;
  device: Device;
  from: number;
  speed?: number;
}

export interface Pose {
  rotateX: number;
  rotateY: number;
  scale: number;
  x: number;
  y: number;
}

export type Layout = "duo" | "desktop" | "phone" | "card";

export interface Cut {
  beats: number;
  layout: Layout;
  sources: Source[];
  move?: [Pose, Pose];
  caption?: string;
  eyebrow?: string;
  card?: "waveform" | "word" | "end";
}

export interface ShotEdit {
  shot: string;
  cuts: Cut[];
}

export interface ActiveCut {
  shot: number;
  cut: Cut;
  index: number;
  start: number;
  end: number;
  local: number;
  progress: number;
}

export function sourceTime(source: Source, local: number): number {
  return source.from + local * (source.speed ?? 1);
}

export function cutAt(
  board: Storyboard,
  edits: ShotEdit[],
  grid: BeatGrid,
  time: number,
): ActiveCut {
  const beat = beatLength(grid);
  let last: ActiveCut | null = null;
  for (const [shot, edit] of edits.entries()) {
    let start = barTime(grid, board.shots[shot].bar);
    for (const [index, cut] of edit.cuts.entries()) {
      const end = start + cut.beats * beat;
      const active = {
        shot,
        cut,
        index,
        start,
        end,
        local: time - start,
        progress: (time - start) / (end - start),
      };
      if (time < end)
        return {
          ...active,
          local: Math.max(active.local, 0),
          progress: Math.min(Math.max(active.progress, 0), 1),
        };
      last = active;
      start = end;
    }
  }
  if (!last) throw new Error("The edit has no cuts");
  return { ...last, local: last.end - last.start, progress: 1 };
}

export function editErrors(
  board: Storyboard,
  edits: ShotEdit[],
  grid: BeatGrid,
): string[] {
  const errors: string[] = [];
  if (edits.length !== board.shots.length) {
    errors.push(
      `${edits.length} edited shots for ${board.shots.length} storyboard shots`,
    );
  }
  board.shots.forEach((shot, index) => {
    const edit = edits[index];
    if (!edit) return;
    if (edit.shot !== shot.title)
      errors.push(
        `shot ${index + 1} is "${shot.title}", the edit says "${edit.shot}"`,
      );
    const beats = edit.cuts.reduce((sum, cut) => sum + cut.beats, 0);
    const expected = shot.bars * grid.beatsPerBar;
    if (beats !== expected)
      errors.push(
        `"${shot.title}" cuts last ${beats} beats, the shot ${expected}`,
      );
    for (const cut of edit.cuts) {
      const needs = cut.layout === "card" ? 0 : cut.layout === "duo" ? 2 : 1;
      if (cut.sources.length < needs)
        errors.push(
          `"${shot.title}" has a ${cut.layout} cut with ${cut.sources.length} sources`,
        );
      if (
        cut.layout === "duo" &&
        new Set(cut.sources.map((source) => source.device)).size !== 2
      ) {
        errors.push(`"${shot.title}" has a duo cut without both devices`);
      }
    }
  });
  return errors;
}

export function takesIn(edits: ShotEdit[]): string[] {
  const keys = edits.flatMap((edit) =>
    edit.cuts.flatMap((cut) => cut.sources.map((s) => `${s.take}/${s.device}`)),
  );
  return [...new Set(keys)].sort();
}

// Variety rule: a take never fills two cuts in a row on the same device and stays under maxShare of
// the film, except the star shots that carry a section on purpose.
export function repetitionErrors(
  edits: ShotEdit[],
  stars: string[],
  maxShare = 0.12,
): string[] {
  const errors: string[] = [];
  const cuts = edits.flatMap((edit) =>
    edit.cuts.filter((cut) => cut.layout !== "card"),
  );
  const total = edits
    .flatMap((edit) => edit.cuts)
    .reduce((sum, cut) => sum + cut.beats, 0);
  const beats = new Map<string, number>();
  let previous = new Set<string>();
  for (const cut of cuts) {
    const keys = new Set(
      cut.sources.map((source) => `${source.take}/${source.device}`),
    );
    for (const key of keys) {
      const take = key.split("/")[0];
      if (previous.has(key) && !stars.includes(take))
        errors.push(`${key} fills two cuts in a row`);
    }
    for (const take of new Set(cut.sources.map((source) => source.take))) {
      beats.set(take, (beats.get(take) ?? 0) + cut.beats);
    }
    previous = keys;
  }
  for (const [take, count] of beats) {
    if (!stars.includes(take) && count / total > maxShare) {
      errors.push(
        `${take} fills ${Math.round((count / total) * 100)}% of the film`,
      );
    }
  }
  return errors;
}
