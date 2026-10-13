export function formatCount(value: number, compact = false): string {
  const rounded = Math.round(value);
  if (compact && rounded >= 1000) return `${(rounded / 1000).toFixed(1)}K`;
  return rounded.toLocaleString("en-US");
}

export function countAt(target: number, progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return target * (1 - (1 - clamped) ** 3);
}
