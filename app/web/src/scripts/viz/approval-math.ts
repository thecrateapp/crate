export type StepState = "pending" | "active" | "done";

export interface FlowFrame {
  index: number;
  local: number;
  states: StepState[];
  approved: boolean;
  fill: number;
  finished: boolean;
}

export const APPROVE_AT = 0.6;

export function flowAt(
  progress: number,
  weights: readonly number[],
  gate: number,
): FlowFrame {
  const count = weights.length;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const at = Math.min(1, Math.max(0, progress)) * total;
  const finished = progress >= 1;
  let index = 0;
  let start = 0;
  while (index < count - 1 && at >= start + weights[index]!) {
    start += weights[index]!;
    index += 1;
  }
  const local = Math.min(1, (at - start) / weights[index]!);
  const states = weights.map<StepState>((_, i) =>
    finished || i < index ? "done" : i === index ? "active" : "pending",
  );
  const approved =
    finished || index > gate || (index === gate && local >= APPROVE_AT);
  const fill = finished ? 1 : Math.min(1, (index + local) / (count - 1));
  return { index, local, states, approved, fill, finished };
}
