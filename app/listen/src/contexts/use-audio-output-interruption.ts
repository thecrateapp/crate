import {
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from "react";

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

  useLayoutEffect(() => {
    pauseRef.current = pause;
    resumeRef.current = resume;
  }, [pause, resume]);

  useEffect(() => {
    if (isNative || isTauriRuntime) return;

    const mediaDevices =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: mediaDevices
        ? async () => {
            const devices = await mediaDevices.enumerateDevices();
            return devices
              .filter((device) => device.kind === "audiooutput")
              .map((device) => device.deviceId);
          }
        : undefined,
      enumerateInputDevices: mediaDevices
        ? async () => {
            const devices = await mediaDevices.enumerateDevices();
            return devices
              .filter((device) => device.kind !== "audiooutput")
              .map(
                (device) =>
                  `${device.kind}:${device.deviceId}:${device.groupId}`,
              );
          }
        : undefined,
      getAudioContext,
      isPlaying: () => isPlayingRef.current,
      mediaDevices,
      pause: (options) => pauseRef.current(options),
      resume: () => resumeRef.current(),
    });
    controllerRef.current = controller;
    controller.install();
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [isPlayingRef]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const cleanupObservation = controller.observe();
    return () => {
      cleanupObservation();
    };
  }, [currentTrack?.id, isPlaying]);
}
