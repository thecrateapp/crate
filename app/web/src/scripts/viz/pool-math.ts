export interface Job {
  id: string;
  duration: number;
}

export interface Slot extends Job {
  worker: number;
  start: number;
  end: number;
}

export function schedulePool(
  jobs: readonly Job[],
  workers: number,
): Omit<Slot, "duration">[] {
  const free = Array.from({ length: Math.max(1, workers) }, () => 0);
  return jobs.map(({ id, duration }) => {
    const worker = free.indexOf(Math.min(...free));
    const start = free[worker]!;
    free[worker] = start + duration;
    return { id, worker, start, end: start + duration };
  });
}
