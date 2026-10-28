export interface Span {
  top: number;
  bottom: number;
}

export function activeStep(steps: Span[], probe: number): number {
  let active = -1;
  steps.forEach((step, index) => {
    if (step.top <= probe) active = index;
  });
  return active;
}

export function railProgress(rail: Span, probe: number): number {
  const height = rail.bottom - rail.top;
  if (height <= 0) return 0;
  return Math.min(1, Math.max(0, (probe - rail.top) / height));
}
