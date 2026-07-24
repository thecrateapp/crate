export type ConcretePlaybackDeliveryPolicy =
  | "original"
  | "balanced"
  | "data_saver";

export interface NetworkHint {
  saveData?: boolean;
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  downlinkMbps?: number;
  rttMs?: number;
}

export interface PlaybackSignals {
  consecutiveStalls: number;
  firstPlayMs?: number;
  bufferedAheadSeconds?: number;
  stablePlaybackSeconds: number;
}

export interface BrowserNetworkConnection {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

const STALL_WINDOW_MS = 60_000;
const STABLE_PLAYBACK_SECONDS = 120;
let recentStallTimes: number[] = [];
let sessionSignals: PlaybackSignals = {
  consecutiveStalls: 0,
  stablePlaybackSeconds: 0,
};

export function resetPlaybackQualitySignals(): void {
  recentStallTimes = [];
  sessionSignals = { consecutiveStalls: 0, stablePlaybackSeconds: 0 };
}

export function getPlaybackQualitySignals(): PlaybackSignals {
  return { ...sessionSignals };
}

export function recordPlaybackStall(now = Date.now()): PlaybackSignals {
  recentStallTimes = recentStallTimes.filter(
    (occurredAt) => now - occurredAt <= STALL_WINDOW_MS,
  );
  recentStallTimes.push(now);
  sessionSignals = {
    consecutiveStalls: recentStallTimes.length,
    stablePlaybackSeconds: 0,
  };
  return getPlaybackQualitySignals();
}

export function recordStablePlayback(seconds: number): PlaybackSignals {
  sessionSignals = {
    ...sessionSignals,
    stablePlaybackSeconds: Math.max(
      sessionSignals.stablePlaybackSeconds,
      seconds,
    ),
  };
  if (sessionSignals.stablePlaybackSeconds >= STABLE_PLAYBACK_SECONDS) {
    recentStallTimes = [];
    sessionSignals = {
      consecutiveStalls: 0,
      stablePlaybackSeconds: sessionSignals.stablePlaybackSeconds,
    };
  }
  return getPlaybackQualitySignals();
}

export function getPlaybackNetworkHint(
  connection: BrowserNetworkConnection | undefined,
): NetworkHint {
  const effectiveType = connection?.effectiveType?.toLowerCase();
  return {
    saveData: connection?.saveData,
    effectiveType:
      effectiveType === "slow-2g" ||
      effectiveType === "2g" ||
      effectiveType === "3g" ||
      effectiveType === "4g"
        ? effectiveType
        : undefined,
    downlinkMbps: connection?.downlink,
    rttMs: connection?.rtt,
  };
}

function downgrade(
  policy: ConcretePlaybackDeliveryPolicy,
): ConcretePlaybackDeliveryPolicy {
  if (policy === "original") return "balanced";
  if (policy === "balanced") return "data_saver";
  return "data_saver";
}

/**
 * Resolves the automatic setting to a concrete server-facing policy. It is
 * deliberately stateless: callers retain user preference and session facts,
 * while this function never observes browser globals or persists network data.
 */
export function getEffectiveAutoPlaybackPolicy(
  hint: NetworkHint,
  signals: PlaybackSignals,
  platformDefault: ConcretePlaybackDeliveryPolicy,
): ConcretePlaybackDeliveryPolicy {
  const effectiveType = hint.effectiveType;
  const dataSaver =
    hint.saveData === true ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    (typeof hint.downlinkMbps === "number" && hint.downlinkMbps < 1.5) ||
    (typeof hint.rttMs === "number" && hint.rttMs >= 800);
  if (dataSaver) return "data_saver";

  const balanced =
    effectiveType === "3g" ||
    (typeof hint.downlinkMbps === "number" && hint.downlinkMbps < 5) ||
    (typeof hint.rttMs === "number" && hint.rttMs >= 350);
  const hintedPolicy: ConcretePlaybackDeliveryPolicy = balanced
    ? "balanced"
    : platformDefault;

  // A single transient stall is common on mobile wake/background changes.
  // Require two consecutive stalls before taking the next track down a tier.
  if (signals.consecutiveStalls >= 2) {
    return downgrade(hintedPolicy);
  }
  return hintedPolicy;
}
