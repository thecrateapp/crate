import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  buildPlaybackStatePayload,
  markCurrentConnectDevicePresent,
  registerCurrentConnectDevice,
  publishPlaybackState,
} from "@/lib/remote-playback-state";

const LIGHT_CHECKPOINT_INTERVAL_MS = 10000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 30000;

interface UseRemotePlaybackStateOptions {
  authUser: AuthUser | null;
  enabled?: boolean;
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  playSource: PlaySource | null;
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  durationRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  shuffleRef: MutableRefObject<boolean>;
  repeatRef: MutableRefObject<RepeatMode>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  unshuffledQueueRef: MutableRefObject<Track[] | null>;
  suppressNextActiveClaimRef?: MutableRefObject<boolean>;
}

interface RemotePlaybackStatePublisher {
  publishStructuralNow: (options?: { claimActive?: boolean }) => Promise<void>;
}

export function useRemotePlaybackState({
  authUser,
  enabled = true,
  queue,
  currentIndex,
  isPlaying,
  shuffle,
  repeat,
  playSource,
  queueRef,
  currentIndexRef,
  currentTimeRef,
  durationRef,
  isPlayingRef,
  shuffleRef,
  repeatRef,
  playSourceRef,
  unshuffledQueueRef,
  suppressNextActiveClaimRef,
}: UseRemotePlaybackStateOptions): RemotePlaybackStatePublisher {
  const lastStructuralRevisionRef = useRef<string | null>(null);
  const previousIsPlayingRef = useRef(isPlaying);
  const pendingPublishFramesRef = useRef<{
    light: number | null;
    structural: number | null;
  }>({ light: null, structural: null });

  const buildPayload = useCallback(
    (
      snapshotKind: "light" | "structural",
      options?: { claimActive?: boolean },
    ) => {
      return buildPlaybackStatePayload({
        queue: queueRef.current,
        currentIndex: currentIndexRef.current,
        currentTime: currentTimeRef.current,
        duration: durationRef.current,
        isPlaying: isPlayingRef.current,
        repeat: repeatRef.current,
        shuffle: shuffleRef.current,
        playSource: playSourceRef.current,
        unshuffledQueue: unshuffledQueueRef.current,
        snapshotKind,
        claimActive: options?.claimActive,
      });
    },
    [
      currentIndexRef,
      currentTimeRef,
      durationRef,
      isPlayingRef,
      playSourceRef,
      queueRef,
      repeatRef,
      shuffleRef,
      unshuffledQueueRef,
    ],
  );

  const publish = useCallback(
    (
      snapshotKind: "light" | "structural",
      options?: { keepalive?: boolean; claimActive?: boolean },
    ) => {
      if (!authUser || !enabled) return;
      const payload = buildPayload(snapshotKind, {
        claimActive: options?.claimActive,
      });
      if (snapshotKind === "structural") {
        if (payload.queue_revision === lastStructuralRevisionRef.current)
          return;
        lastStructuralRevisionRef.current = payload.queue_revision;
      }
      void publishPlaybackState(
        payload,
        options?.keepalive ? { keepalive: true } : undefined,
      ).catch(() => {});
    },
    [authUser, buildPayload, enabled],
  );

  const publishStructuralNow = useCallback(
    async (options?: { claimActive?: boolean }) => {
      if (!authUser || !enabled) return;
      const payload = buildPayload("structural", {
        claimActive: options?.claimActive,
      });
      lastStructuralRevisionRef.current = payload.queue_revision;
      await publishPlaybackState(payload);
    },
    [authUser, buildPayload, enabled],
  );

  const publishStructuralNowRef = useRef(publishStructuralNow);
  useEffect(() => {
    publishStructuralNowRef.current = publishStructuralNow;
  }, [publishStructuralNow]);

  const stablePublisher = useRef<RemotePlaybackStatePublisher>({
    publishStructuralNow: (options) => publishStructuralNowRef.current(options),
  });

  const schedulePublish = useCallback(
    (
      snapshotKind: "light" | "structural",
      options?: { claimActive?: boolean },
    ) => {
      const claimActive = options?.claimActive;
      if (claimActive) {
        publish(snapshotKind, { claimActive: true });
        return;
      }
      const pendingFrame = pendingPublishFramesRef.current[snapshotKind];
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
      }
      pendingPublishFramesRef.current[snapshotKind] =
        window.requestAnimationFrame(() => {
          pendingPublishFramesRef.current[snapshotKind] = null;
          publish(snapshotKind);
        });
    },
    [publish],
  );

  useEffect(() => {
    return () => {
      const pendingFrames = pendingPublishFramesRef.current;
      if (pendingFrames.light !== null) {
        window.cancelAnimationFrame(pendingFrames.light);
      }
      if (pendingFrames.structural !== null) {
        window.cancelAnimationFrame(pendingFrames.structural);
      }
      pendingFrames.light = null;
      pendingFrames.structural = null;
    };
  }, []);

  useEffect(() => {
    if (!authUser || !enabled) return;
    void registerCurrentConnectDevice()
      .then(() => markCurrentConnectDevicePresent())
      .then(() => {
        if (!isPlayingRef.current || !queueRef.current.length) {
          return;
        }
        publish("structural", { claimActive: true });
      })
      .catch(() => {});
  }, [authUser, enabled, isPlayingRef, publish, queueRef]);

  useEffect(() => {
    if (!authUser || !enabled) return;
    const intervalId = window.setInterval(() => {
      void markCurrentConnectDevicePresent().catch(() => {});
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [authUser, enabled]);

  useEffect(() => {
    if (!enabled) return;
    schedulePublish("structural");
  }, [
    currentIndex,
    enabled,
    playSource,
    queue,
    repeat,
    schedulePublish,
    shuffle,
  ]);

  useEffect(() => {
    if (!enabled) return;
    let claimActive = isPlaying && !previousIsPlayingRef.current;
    if (claimActive && suppressNextActiveClaimRef?.current) {
      claimActive = false;
      suppressNextActiveClaimRef.current = false;
    }
    previousIsPlayingRef.current = isPlaying;
    schedulePublish("light", { claimActive });
  }, [enabled, isPlaying, schedulePublish, suppressNextActiveClaimRef]);

  useEffect(() => {
    if (!authUser || !enabled) return;
    const intervalId = window.setInterval(() => {
      if (!queueRef.current.length) return;
      publish("light");
    }, LIGHT_CHECKPOINT_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [authUser, enabled, publish, queueRef]);

  useEffect(() => {
    if (!authUser || !enabled) return;
    const handler = () => {
      if (!queueRef.current.length) return;
      publish("light", { keepalive: true });
    };
    window.addEventListener("pagehide", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, [authUser, enabled, publish, queueRef]);

  return stablePublisher.current;
}
