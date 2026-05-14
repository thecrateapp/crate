import { useEffect, type MutableRefObject } from "react";

import type { Track } from "@/contexts/player-types";
import {
  DESKTOP_TRAY_COMMAND_EVENT,
  syncDesktopNowPlaying,
  type DesktopTrayCommand,
} from "@/lib/desktop-tray";

interface UseDesktopTrayCommandsParams {
  isPlayingRef: MutableRefObject<boolean>;
  pause: () => void;
  resume: () => void;
  previous: () => void;
  next: () => void;
}

export function useDesktopTrayCommands({
  isPlayingRef,
  pause,
  resume,
  previous,
  next,
}: UseDesktopTrayCommandsParams) {
  useEffect(() => {
    const onTrayCommand = (event: Event) => {
      const command = (event as CustomEvent<DesktopTrayCommand>).detail;
      if (command === "play_pause") {
        if (isPlayingRef.current) {
          pause();
        } else {
          resume();
        }
        return;
      }
      if (command === "play") {
        resume();
        return;
      }
      if (command === "pause") {
        pause();
        return;
      }
      if (command === "previous") {
        previous();
        return;
      }
      if (command === "next") {
        next();
      }
    };

    window.addEventListener(DESKTOP_TRAY_COMMAND_EVENT, onTrayCommand);
    return () => {
      window.removeEventListener(DESKTOP_TRAY_COMMAND_EVENT, onTrayCommand);
    };
  }, [isPlayingRef, next, pause, previous, resume]);
}

export function useDesktopTrayNowPlaying({
  currentTrack,
  isPlaying,
}: {
  currentTrack: Track | undefined;
  isPlaying: boolean;
}) {
  useEffect(() => {
    syncDesktopNowPlaying({
      title: currentTrack?.title ?? null,
      artist: currentTrack?.artist ?? null,
      isPlaying,
    });
  }, [currentTrack?.artist, currentTrack?.id, currentTrack?.title, isPlaying]);
}
