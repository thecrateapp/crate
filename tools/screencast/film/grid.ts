export interface BeatGrid {
  id: string;
  artist: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  firstBar: number;
  bars: number;
  sourceStart: number;
  duration: number;
  beats: number[];
  energy: number[];
}

export interface Position {
  bar: number;
  beat: number;
  beatIndex: number;
  beatProgress: number;
}

export function beatLength(grid: BeatGrid): number {
  return 60 / grid.bpm;
}

export function barTime(grid: BeatGrid, bar: number): number {
  return (bar - grid.firstBar) * grid.beatsPerBar * beatLength(grid);
}

export function positionAt(grid: BeatGrid, time: number): Position {
  const length = beatLength(grid);
  const total = grid.bars * grid.beatsPerBar;
  const beatIndex = Math.min(Math.max(Math.floor(time / length), 0), total - 1);
  return {
    bar: grid.firstBar + Math.floor(beatIndex / grid.beatsPerBar),
    beat: (beatIndex % grid.beatsPerBar) + 1,
    beatIndex,
    beatProgress: Math.min(Math.max(time / length - beatIndex, 0), 1),
  };
}
