import { useEffect, useMemo, useRef } from "react";

import type { Track } from "@/contexts/player-types";
import { scheduleWarmup } from "@/hooks/listen-warmup-runner";
import { api } from "@/lib/api";
import {
  LAUNCHER_ART_DEPS,
  launcherArtMissing,
} from "@/lib/desktop-launcher-art-runtime";
import {
  loadPrewarmEntries,
  trackArtEntries,
  warmLauncherArt,
  type PrewarmDeps,
} from "@/lib/desktop-launcher-prewarm";
import { isTauriRuntime } from "@/lib/platform";

/** Tracks of the queue whose albums and artists are kept warm. */
export const PREWARM_QUEUE_LIMIT = 100;
/** The queue changes in bursts (an album is added track by track). */
export const QUEUE_PREWARM_DELAY_MS = 3_000;

const DEPS: PrewarmDeps = {
  missing: launcherArtMissing,
  art: LAUNCHER_ART_DEPS,
};

/**
 * Desktop only: fill the launcher's art cache with what the user listens to,
 * in the background and at low priority. Once at startup (history, most
 * played and followed artists), for each new track, and for the queue once
 * it settles. Off Linux the shell has no launcher cache and this stops at
 * the first check.
 */
export function useLauncherArtPrewarm({
  currentTrack,
  queue,
}: {
  currentTrack: Track | undefined;
  queue: readonly Track[];
}) {
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const cancel = scheduleWarmup(() => {
      void (async () => {
        if ((await DEPS.missing([])) === null) return;
        if (controller.signal.aborted) return;
        const entries = await loadPrewarmEntries((url) => api(url));
        if (controller.signal.aborted) return;
        await warmLauncherArt(entries, DEPS, controller.signal);
      })().catch(() => {});
    });
    return () => {
      cancel();
      controller.abort();
      controllerRef.current = null;
    };
  }, []);

  // a new track: its album and artist (deps on the id only, not progress)
  const trackRef = useRef(currentTrack);
  trackRef.current = currentTrack;
  const trackId = currentTrack?.id ?? null;
  useEffect(() => {
    const track = trackRef.current;
    if (!isTauriRuntime || !track) return;
    void warmLauncherArt(
      trackArtEntries([track]),
      DEPS,
      controllerRef.current?.signal,
    ).catch(() => {});
  }, [trackId]);

  const queueEntries = useMemo(
    () => trackArtEntries(queue.slice(0, PREWARM_QUEUE_LIMIT)),
    [queue],
  );
  const queueSignature = queueEntries.map(([key]) => key).join(",");
  const queueEntriesRef = useRef(queueEntries);
  queueEntriesRef.current = queueEntries;
  useEffect(() => {
    if (!isTauriRuntime || !queueSignature) return;
    const timer = setTimeout(() => {
      void warmLauncherArt(
        queueEntriesRef.current,
        DEPS,
        controllerRef.current?.signal,
      ).catch(() => {});
    }, QUEUE_PREWARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [queueSignature]);
}
