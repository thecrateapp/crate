import type { PlaySource, Track } from "@/contexts/player-types";
import type { EngineTransitionPlan } from "@/lib/playback-engine";

export const SMART_TRANSITION_SHORT_SECONDS = 2;
export const SMART_TRANSITION_BALANCED_SECONDS = 4;
export const SMART_TRANSITION_LONG_SECONDS = 6;
export const SMART_TRANSITION_MIXED_QUEUE_SECONDS = 3;

const SMART_TRANSITION_MIN_SIGNAL_WEIGHT = 0.35;
const SMART_MIX_PLANNER_VERSION = "smart-mix-v1";
const MAX_TRANSITION_DURATION_MS = 12_000;
const KEY_TO_PITCH_CLASS: Record<string, number> = {
  c: 0,
  "b#": 0,
  "c#": 1,
  db: 1,
  d: 2,
  "d#": 3,
  eb: 3,
  e: 4,
  fb: 4,
  "e#": 5,
  f: 5,
  "f#": 6,
  gb: 6,
  g: 7,
  "g#": 8,
  ab: 8,
  a: 9,
  "a#": 10,
  bb: 10,
  b: 11,
  cb: 11,
};

export interface SmartMixCapabilities {
  available: boolean;
  androidNativeCrossfade: boolean;
  androidBeatmatch: boolean;
  plannerVersion?: string | null;
}

const DISABLED_SMART_MIX_CAPABILITIES: SmartMixCapabilities = {
  available: false,
  androidNativeCrossfade: false,
  androidBeatmatch: false,
  plannerVersion: null,
};

let smartMixCapabilities = DISABLED_SMART_MIX_CAPABILITIES;

export function setSmartMixCapabilities(
  capabilities: SmartMixCapabilities,
): void {
  smartMixCapabilities = {
    available: capabilities.available === true,
    androidNativeCrossfade: capabilities.androidNativeCrossfade === true,
    androidBeatmatch: capabilities.androidBeatmatch === true,
    plannerVersion: capabilities.plannerVersion ?? null,
  };
}

export function getSmartMixCapabilities(): SmartMixCapabilities {
  return { ...smartMixCapabilities };
}

interface SmartMixPlanInput {
  revision: string;
  tracks: Track[];
  currentIndex: number;
  playSource: PlaySource | null;
  shuffle: boolean;
  offline: boolean;
  preferredDurationMs: number;
  capabilities: SmartMixCapabilities;
}

interface TransitionEdge {
  outgoing: Track;
  incoming: Track;
}

interface TransitionPlanResponse {
  plannerVersion: number;
  outgoingTrackEntityUid: string;
  incomingTrackEntityUid: string;
  mode: "gapless" | "adaptive" | "beatmatch";
  durationMs: number;
  outgoingCueMs: number;
  incomingCueMs: number;
  incomingTempoRatio: number;
  beatPhaseOffsetMs: number;
  handoffProgress: number;
  outgoingGainDb: number;
  incomingGainDb: number;
  curve: "equal-power";
  bassHandoff: "none" | "balanced";
  confidence: number;
  fallbackReason?: string | null;
}

interface TransitionPlanBatchResponse {
  plannerVersion: "smart-mix-v1";
  plans: TransitionPlanResponse[];
}

export type SmartMixRequest = (
  path: string,
  method: "POST",
  body: unknown,
  options: { signal: AbortSignal },
) => Promise<TransitionPlanBatchResponse>;

export class SmartMixTransitionPlanner {
  private active:
    | {
        revision: string;
        controller: AbortController;
      }
    | undefined;

  constructor(private readonly request: SmartMixRequest) {}

  async plan(input: SmartMixPlanInput): Promise<EngineTransitionPlan[]> {
    if (this.active && this.active.revision !== input.revision) {
      this.active.controller.abort();
    }

    const edges = boundedTransitionEdges(input.tracks, input.currentIndex);
    if (edges.length === 0) return [];

    const localPlans = new Map<string, EngineTransitionPlan>();
    const unresolved: TransitionEdge[] = [];
    for (const edge of edges) {
      if (isKnownAlbumSequence(edge, input)) {
        localPlans.set(edgeKey(edge), albumGaplessPlan(edge));
      } else {
        unresolved.push(edge);
      }
    }

    if (unresolved.length === 0) {
      return orderedPlans(edges, localPlans);
    }

    const capabilityAvailable =
      input.capabilities.available &&
      input.capabilities.androidNativeCrossfade &&
      input.capabilities.plannerVersion === SMART_MIX_PLANNER_VERSION;
    if (!capabilityAvailable) {
      for (const edge of unresolved) {
        localPlans.set(
          edgeKey(edge),
          safeTransitionPlan(edge, 0, "capability_unavailable"),
        );
      }
      return orderedPlans(edges, localPlans);
    }

    const requestable = unresolved.filter(
      (edge) => edge.outgoing.entityUid && edge.incoming.entityUid,
    );
    for (const edge of unresolved) {
      if (!edge.outgoing.entityUid || !edge.incoming.entityUid) {
        localPlans.set(
          edgeKey(edge),
          safeTransitionPlan(
            edge,
            input.preferredDurationMs,
            "missing_profile",
          ),
        );
      }
    }
    if (requestable.length === 0) {
      return orderedPlans(edges, localPlans);
    }

    const controller = new AbortController();
    this.active = { revision: input.revision, controller };
    try {
      const response = await this.request(
        "/api/playback/transition-plans",
        "POST",
        {
          plannerVersion: SMART_MIX_PLANNER_VERSION,
          edges: requestable.map((edge) => ({
            outgoingTrackEntityUid: edge.outgoing.entityUid,
            incomingTrackEntityUid: edge.incoming.entityUid,
            context: {
              source: transitionSource(input.playSource, input.shuffle),
              automatic: true,
              offline: input.offline,
              preferredDurationMs: clampDuration(input.preferredDurationMs),
              userCueProfile: "default",
              allowBeatmatch: input.capabilities.androidBeatmatch,
              allowTempoAdjustment: input.capabilities.androidBeatmatch,
            },
          })),
        },
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        this.active?.revision !== input.revision
      ) {
        return [];
      }

      const responsePlans =
        response?.plannerVersion === SMART_MIX_PLANNER_VERSION &&
        Array.isArray(response.plans)
          ? response.plans
          : [];
      for (const edge of requestable) {
        const serverPlan = responsePlans.find(
          (plan) =>
            plan.outgoingTrackEntityUid === edge.outgoing.entityUid &&
            plan.incomingTrackEntityUid === edge.incoming.entityUid,
        );
        const compatibleServerPlan =
          serverPlan?.plannerVersion === 1 ? serverPlan : undefined;
        localPlans.set(
          edgeKey(edge),
          compatibleServerPlan
            ? engineTransitionPlan(edge, compatibleServerPlan)
            : safeTransitionPlan(
                edge,
                input.preferredDurationMs,
                "missing_profile",
              ),
        );
      }
      return orderedPlans(edges, localPlans);
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return [];
      }
      for (const edge of requestable) {
        localPlans.set(
          edgeKey(edge),
          safeTransitionPlan(
            edge,
            input.preferredDurationMs,
            "planner_unavailable",
          ),
        );
      }
      return orderedPlans(edges, localPlans);
    } finally {
      if (this.active?.controller === controller) {
        this.active = undefined;
      }
    }
  }
}

function boundedTransitionEdges(
  tracks: Track[],
  currentIndex: number,
): TransitionEdge[] {
  const normalizedIndex = Math.max(0, Math.trunc(currentIndex));
  const edges: TransitionEdge[] = [];
  for (const index of [normalizedIndex, normalizedIndex + 1]) {
    const outgoing = tracks[index];
    const incoming = tracks[index + 1];
    if (outgoing && incoming) {
      edges.push({ outgoing, incoming });
    }
  }
  return edges;
}

function isKnownAlbumSequence(
  edge: TransitionEdge,
  input: SmartMixPlanInput,
): boolean {
  return (
    !input.shuffle &&
    input.playSource?.type === "album" &&
    !!edge.outgoing.album &&
    edge.outgoing.album === edge.incoming.album &&
    !!edge.outgoing.artist &&
    edge.outgoing.artist === edge.incoming.artist
  );
}

function edgeKey(edge: TransitionEdge): string {
  return `${edge.outgoing.id}\u0000${edge.incoming.id}`;
}

function orderedPlans(
  edges: TransitionEdge[],
  plans: Map<string, EngineTransitionPlan>,
): EngineTransitionPlan[] {
  return edges.flatMap((edge) => {
    const plan = plans.get(edgeKey(edge));
    return plan ? [plan] : [];
  });
}

function albumGaplessPlan(edge: TransitionEdge): EngineTransitionPlan {
  return {
    ...safeTransitionPlan(edge, 0, "album_sequence"),
    mode: "gapless",
    durationMs: 0,
    confidence: 1,
  };
}

function safeTransitionPlan(
  edge: TransitionEdge,
  preferredDurationMs: number,
  fallbackReason: string,
): EngineTransitionPlan {
  const durationMs = clampDuration(preferredDurationMs);
  return {
    plannerVersion: 1,
    outgoingTrackId: edge.outgoing.id,
    incomingTrackId: edge.incoming.id,
    mode: durationMs > 0 ? "adaptive" : "gapless",
    durationMs,
    outgoingCueMs: 0,
    incomingCueMs: 0,
    incomingTempoRatio: 1,
    beatPhaseOffsetMs: 0,
    handoffProgress: 0.5,
    outgoingGainDb: 0,
    incomingGainDb: 0,
    curve: "equal-power",
    bassHandoff: "none",
    confidence: 0,
    fallbackReason,
  };
}

function engineTransitionPlan(
  edge: TransitionEdge,
  plan: TransitionPlanResponse,
): EngineTransitionPlan {
  return {
    plannerVersion: plan.plannerVersion,
    outgoingTrackId: edge.outgoing.id,
    incomingTrackId: edge.incoming.id,
    mode: plan.mode,
    durationMs: plan.durationMs,
    outgoingCueMs: plan.outgoingCueMs,
    incomingCueMs: plan.incomingCueMs,
    incomingTempoRatio: plan.incomingTempoRatio,
    beatPhaseOffsetMs: plan.beatPhaseOffsetMs,
    handoffProgress: plan.handoffProgress,
    outgoingGainDb: plan.outgoingGainDb,
    incomingGainDb: plan.incomingGainDb,
    curve: plan.curve,
    bassHandoff: plan.bassHandoff,
    confidence: plan.confidence,
    fallbackReason: plan.fallbackReason ?? undefined,
  };
}

function transitionSource(
  playSource: PlaySource | null,
  shuffle: boolean,
): "album" | "playlist" | "radio" | "shuffle" | "infinite" | "manual" {
  if (shuffle) return "shuffle";
  if (
    playSource?.type === "album" ||
    playSource?.type === "playlist" ||
    playSource?.type === "radio"
  ) {
    return playSource.type;
  }
  return "manual";
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), MAX_TRANSITION_DURATION_MS));
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeScale(
  scale: string | null | undefined,
): "major" | "minor" | null {
  const normalized = scale?.trim().toLowerCase();
  if (normalized === "major" || normalized === "minor") return normalized;
  return null;
}

function pitchClass(key: string | null | undefined): number | null {
  const normalized = key
    ?.trim()
    .toLowerCase()
    .replace("\u266f", "#")
    .replace("\u266d", "b");
  if (!normalized) return null;
  return KEY_TO_PITCH_CLASS[normalized] ?? null;
}

function bpmCompatibility(
  currentBpm: number | null | undefined,
  nextBpm: number | null | undefined,
): number | null {
  const current = finiteNumber(currentBpm);
  const next = finiteNumber(nextBpm);
  if (!current || !next || current <= 0 || next <= 0) return null;
  const candidates = [next, next / 2, next * 2];
  const diff = Math.min(
    ...candidates.map((candidate) => Math.abs(current - candidate)),
  );
  return Math.max(0, 1 - diff / 32);
}

function scalarCompatibility(
  currentValue: number | null | undefined,
  nextValue: number | null | undefined,
): number | null {
  const current = finiteNumber(currentValue);
  const next = finiteNumber(nextValue);
  if (current == null || next == null) return null;
  return Math.max(0, 1 - Math.abs(current - next));
}

function keyCompatibility(
  currentTrack: Track,
  nextTrack: Track,
): number | null {
  const currentKey = pitchClass(currentTrack.audioKey);
  const nextKey = pitchClass(nextTrack.audioKey);
  if (currentKey == null || nextKey == null) return null;

  const currentScale = normalizeScale(currentTrack.audioScale);
  const nextScale = normalizeScale(nextTrack.audioScale);
  const distance = Math.min(
    Math.abs(currentKey - nextKey),
    12 - Math.abs(currentKey - nextKey),
  );

  if (distance === 0 && currentScale === nextScale) return 1;
  if (distance === 0) return 0.72;
  if (
    currentScale === "major" &&
    nextScale === "minor" &&
    nextKey === (currentKey + 9) % 12
  )
    return 0.9;
  if (
    currentScale === "minor" &&
    nextScale === "major" &&
    nextKey === (currentKey + 3) % 12
  )
    return 0.9;
  if (distance === 5 || distance === 7)
    return currentScale === nextScale ? 0.78 : 0.62;
  if (distance <= 2) return 0.58;
  return 0.28;
}

function blissCompatibility(
  currentTrack: Track,
  nextTrack: Track,
): number | null {
  const current = currentTrack.blissVector;
  const next = nextTrack.blissVector;
  if (
    !Array.isArray(current) ||
    !Array.isArray(next) ||
    current.length < 3 ||
    current.length !== next.length
  ) {
    return null;
  }

  let dot = 0;
  let currentMagnitude = 0;
  let nextMagnitude = 0;
  for (let index = 0; index < current.length; index += 1) {
    const currentValue = finiteNumber(current[index]);
    const nextValue = finiteNumber(next[index]);
    if (currentValue == null || nextValue == null) return null;
    dot += currentValue * nextValue;
    currentMagnitude += currentValue * currentValue;
    nextMagnitude += nextValue * nextValue;
  }
  if (currentMagnitude <= 0 || nextMagnitude <= 0) return null;
  const cosine = dot / (Math.sqrt(currentMagnitude) * Math.sqrt(nextMagnitude));
  return Math.max(0, Math.min(1, (cosine + 1) / 2));
}

function smartTransitionFeatureScore(
  currentTrack: Track,
  nextTrack: Track,
): number | null {
  const signals: Array<[number, number | null]> = [
    [0.4, blissCompatibility(currentTrack, nextTrack)],
    [0.2, bpmCompatibility(currentTrack.bpm, nextTrack.bpm)],
    [0.15, keyCompatibility(currentTrack, nextTrack)],
    [0.15, scalarCompatibility(currentTrack.energy, nextTrack.energy)],
    [
      0.05,
      scalarCompatibility(currentTrack.danceability, nextTrack.danceability),
    ],
    [0.05, scalarCompatibility(currentTrack.valence, nextTrack.valence)],
  ];

  let weightedScore = 0;
  let totalWeight = 0;
  for (const [weight, score] of signals) {
    if (score == null) continue;
    weightedScore += weight * score;
    totalWeight += weight;
  }
  if (totalWeight < SMART_TRANSITION_MIN_SIGNAL_WEIGHT) return null;
  return weightedScore / totalWeight;
}

function fallbackSmartTransitionSeconds(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
): number {
  if (!currentTrack || !nextTrack) return 0;
  if (playSource?.type === "radio") return SMART_TRANSITION_BALANCED_SECONDS;
  if (playSource?.type === "playlist") return SMART_TRANSITION_BALANCED_SECONDS;
  if (shuffle) return SMART_TRANSITION_BALANCED_SECONDS;
  if (currentTrack.isSuggested || nextTrack.isSuggested)
    return SMART_TRANSITION_BALANCED_SECONDS;
  return SMART_TRANSITION_MIXED_QUEUE_SECONDS;
}

export function legacySmartTransitionSeconds(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
): number {
  if (!currentTrack || !nextTrack) {
    return fallbackSmartTransitionSeconds(
      currentTrack,
      nextTrack,
      playSource,
      shuffle,
    );
  }
  const featureScore = smartTransitionFeatureScore(currentTrack, nextTrack);
  if (featureScore == null) {
    return fallbackSmartTransitionSeconds(
      currentTrack,
      nextTrack,
      playSource,
      shuffle,
    );
  }
  if (featureScore >= 0.78) return SMART_TRANSITION_LONG_SECONDS;
  if (featureScore >= 0.55) return SMART_TRANSITION_BALANCED_SECONDS;
  return SMART_TRANSITION_SHORT_SECONDS;
}
