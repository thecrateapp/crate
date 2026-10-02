export function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(sorted.length * quantile) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[index] ?? null;
}

export function summarizeTimes(values) {
  return {
    minMs: percentile(values, 0),
    medianMs: percentile(values, 0.5),
    maxMs: percentile(values, 1),
  };
}
