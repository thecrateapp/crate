import type { GOVERNOR } from "../../content/admin/viz";

export interface Snapshot {
  loadRatio: number;
  iowaitPercent: number;
  swapUsedPercent: number;
  swapUsedMb: number;
  memoryAvailablePercent: number;
  activeUsers: number;
  activeStreams: number;
}

type Limits = typeof GOVERNOR;

export function evaluateGovernor(
  snapshot: Snapshot,
  limits: Limits,
  listenerSensitive = true,
): string[] {
  const reasons: string[] = [];
  if (listenerSensitive) {
    if (snapshot.activeUsers > limits.maxActiveUsers)
      reasons.push(
        `${snapshot.activeUsers} active listener(s)>${limits.maxActiveUsers}`,
      );
    if (snapshot.activeStreams > limits.maxActiveStreams)
      reasons.push(
        `${snapshot.activeStreams} recent stream(s)>${limits.maxActiveStreams}`,
      );
  }
  if (snapshot.loadRatio > limits.loadRatio)
    reasons.push(
      `load ${snapshot.loadRatio.toFixed(2)}>${limits.loadRatio.toFixed(2)}`,
    );
  if (snapshot.iowaitPercent > limits.iowaitPercent)
    reasons.push(
      `iowait ${snapshot.iowaitPercent.toFixed(
        1,
      )}%>${limits.iowaitPercent.toFixed(1)}%`,
    );
  const swapPressure =
    snapshot.swapUsedMb >= limits.swapMinUsedMb ||
    snapshot.memoryAvailablePercent < limits.minMemoryAvailablePercent;
  if (snapshot.swapUsedPercent > limits.swapPercent && swapPressure)
    reasons.push(
      `swap ${snapshot.swapUsedPercent.toFixed(
        1,
      )}%>${limits.swapPercent.toFixed(1)}%`,
    );
  return reasons;
}

const bump = (t: number, centre: number, width: number) =>
  Math.exp(-(((t - centre) / width) ** 2));

export function governorSnapshot(cycle: number): Snapshot {
  const t = cycle - Math.floor(cycle);
  const spike = bump(t, 0.5, 0.11);
  const ripple = Math.sin(t * Math.PI * 6) * 0.03;
  return {
    loadRatio: Number((0.38 + ripple + spike * 0.6).toFixed(3)),
    iowaitPercent: Number((4 + spike * 29 + ripple * 40).toFixed(2)),
    swapUsedPercent: 3,
    swapUsedMb: 64,
    memoryAvailablePercent: Number((58 - spike * 20).toFixed(1)),
    activeUsers: 2,
    activeStreams: 2 + Math.round(spike * 2),
  };
}
