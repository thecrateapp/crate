import { useEffect, useRef, type MutableRefObject } from "react";

import type { PlayerPauseOptions } from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";
import { isNative } from "@/lib/capacitor-runtime";
import {
  createAudioOutputInterruptionController,
  type AudioOutputInterruptionController,
} from "@/lib/audio-output-interruption";
import { getAudioContext } from "@/lib/gapless-player";
import { isTauriRuntime } from "@/lib/platform";

interface UseAudioOutputInterruptionInput {
  currentTrack: Track | undefined;
  isPlaying: boolean;
  isPlayingRef: MutableRefObject<boolean>;
  pause: (options?: PlayerPauseOptions) => void;
  resume: () => void;
}

export function useAudioOutputInterruption({
  currentTrack,
  isPlaying,
  isPlayingRef,
  pause,
  resume,
}: UseAudioOutputInterruptionInput): void {
  const controllerRef = useRef<AudioOutputInterruptionController | null>(null);
  const pauseRef = useRef(pause);
  const resumeRef = useRef(resume);
  pauseRef.current = pause;
  resumeRef.current = resume;

  if (controllerRef.current === null) {
    const mediaDevices =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

    controllerRef.current = createAudioOutputInterruptionController({
      enumerateOutputDevices: mediaDevices
        ? async () => {
            const devices = await mediaDevices.enumerateDevices();
            return devices
              .filter((device) => device.kind === "audiooutput")
              .map((device) => device.deviceId);
          }
        : undefined,
      getAudioContext,
      isPlaying: () => isPlayingRef.current,
      mediaDevices,
      pause: (options) => pauseRef.current(options),
      resume: () => resumeRef.current(),
    });
  }

  const controller = controllerRef.current;

  useEffect(() => {
    if (isNative || isTauriRuntime) return;

    controller.install();
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    controller.observe();
  }, [controller, currentTrack?.id, isPlaying]);
}
