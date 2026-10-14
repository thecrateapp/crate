export interface Frame {
  file: string;
  t: number;
}

export function frameAt(frames: Frame[], time: number): string | null {
  if (frames.length === 0) return null;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].t <= time) low = middle;
    else high = middle - 1;
  }
  return frames[low].file;
}
