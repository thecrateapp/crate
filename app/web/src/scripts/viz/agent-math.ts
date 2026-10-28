export interface ChatFrame {
  shown: number;
  beat: number;
  finished: boolean;
}

export function chatAt(progress: number, beats: readonly number[]): ChatFrame {
  const count = beats.length;
  const p = Math.min(1, Math.max(0, progress));
  const shown = Math.min(count, 1 + Math.floor(p * count));
  return { shown, beat: beats[shown - 1]!, finished: p >= 1 };
}

export const isPressed = (pressedAt: number, shown: number) =>
  pressedAt < shown;
