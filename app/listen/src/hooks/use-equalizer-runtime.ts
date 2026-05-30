import { useEffect, useMemo, useState } from "react";

import type { Track } from "@/contexts/player-types";
import { useEqFeatures } from "@/hooks/use-eq-features";
import { useEffectiveEq } from "@/hooks/use-effective-eq";
import { useTrackGenre } from "@/hooks/use-track-genre";
import { computeAdaptiveGains } from "@/lib/adaptive-eq";
import { EQ_BAND_COUNT, type EqGains } from "@/lib/equalizer";
import {
  EQ_PREFS_EVENT,
  getEqualizerSnapshot,
  type EqualizerSnapshot,
} from "@/lib/equalizer-prefs";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { setEqualizer as engineSetEqualizer } from "@/lib/gapless-player";
import { canUseWebAudioEffects } from "@/lib/mobile-audio-mode";

const FLAT_GAINS: EqGains = new Array(EQ_BAND_COUNT).fill(0);
export function useEqualizerSnapshotState() {
  const [snapshot, setSnapshot] =
    useState<EqualizerSnapshot>(getEqualizerSnapshot);

  useEffect(() => {
    const sync = () => setSnapshot(getEqualizerSnapshot());
    window.addEventListener(EQ_PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EQ_PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [snapshot, setSnapshot] as const;
}

export function useResolvedEqualizer(
  snapshot: EqualizerSnapshot,
  currentTrack: Track | undefined,
) {
  const effectiveEqState = useEffectiveEq(currentTrack, snapshot.smart);
  const effectiveEq =
    effectiveEqState.status === "ready" ? effectiveEqState.eq : null;

  const featuresState = useEqFeatures(
    !snapshot.smart && snapshot.adaptive ? currentTrack : undefined,
  );
  const features =
    featuresState.status === "ready" ? featuresState.features : null;

  const genreState = useTrackGenre(
    !snapshot.smart && snapshot.genreAdaptive ? currentTrack : undefined,
  );
  const trackGenre = genreState.status === "ready" ? genreState.genre : null;

  const effectiveGains: EqGains = useMemo(() => {
    if (snapshot.smart) {
      if (!effectiveEq || effectiveEq.gains.length !== EQ_BAND_COUNT)
        return FLAT_GAINS;
      return effectiveEq.gains;
    }
    if (snapshot.adaptive) return computeAdaptiveGains(features);
    if (snapshot.genreAdaptive) {
      const preset = trackGenre?.preset;
      if (!preset || preset.gains.length !== EQ_BAND_COUNT) return FLAT_GAINS;
      return preset.gains;
    }
    return snapshot.gains;
  }, [
    features,
    effectiveEq,
    snapshot.adaptive,
    snapshot.gains,
    snapshot.genreAdaptive,
    snapshot.smart,
    trackGenre,
  ]);

  return {
    effectiveGains,
    effectiveEqState,
    effectiveEq,
    featuresState,
    features,
    genreState,
    trackGenre,
  };
}

export function useEqualizerRuntime(currentTrack: Track | undefined) {
  const [snapshot] = useEqualizerSnapshotState();
  const { effectiveGains } = useResolvedEqualizer(snapshot, currentTrack);

  useEffect(() => {
    if (shouldUseAndroidNativePlayer()) {
      engineSetEqualizer(false, FLAT_GAINS);
      void androidNativeEngine
        .setEq(snapshot.enabled, [...effectiveGains], 80)
        .catch((error) => {
          console.error("[native-player] failed to apply equalizer:", error);
        });
      return;
    }
    engineSetEqualizer(
      canUseWebAudioEffects && snapshot.enabled,
      effectiveGains,
    );
  }, [effectiveGains, snapshot.enabled]);
}
