import type { MutableRefObject } from "react";

import type { PlayerActionsValue } from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";

import { useDesktopControlBridge } from "./use-desktop-control-bridge";
import {
  useDesktopTrayCommands,
  useDesktopTrayNowPlaying,
} from "./use-desktop-tray-commands";
import { useMediaSession } from "./use-media-session";
import { usePlayerShortcuts } from "./use-player-shortcuts";

type PlayerPlatformActions = Pick<
  PlayerActionsValue,
  | "next"
  | "pause"
  | "prev"
  | "resume"
  | "seek"
  | "setVolume"
  | "shuffle"
  | "toggleShuffle"
  | "repeat"
  | "setRepeatMode"
  | "play"
  | "playAll"
>;

interface PlayerPlatformIntegrationsInput extends PlayerPlatformActions {
  currentTime: number;
  currentTrack: Track | undefined;
  duration: number;
  isPlaying: boolean;
  isPlayingRef: MutableRefObject<boolean>;
  lastNonZeroVolume: number;
  volume: number;
}

export function usePlayerPlatformIntegrations({
  currentTime,
  currentTrack,
  duration,
  isPlaying,
  isPlayingRef,
  lastNonZeroVolume,
  next,
  pause,
  prev,
  resume,
  seek,
  setVolume,
  shuffle,
  toggleShuffle,
  repeat,
  setRepeatMode,
  play,
  playAll,
  volume,
}: PlayerPlatformIntegrationsInput) {
  usePlayerShortcuts({
    currentTime,
    duration,
    hasCurrentTrack: !!currentTrack,
    isPlaying,
    lastNonZeroVolume,
    next,
    pause,
    prev,
    resume,
    seek,
    setVolume,
    volume,
  });

  useDesktopTrayCommands({
    isPlayingRef,
    next,
    pause,
    previous: prev,
    resume,
  });
  useDesktopTrayNowPlaying({ currentTrack, isPlaying });
  useDesktopControlBridge({
    play,
    playAll,
    repeat,
    seek,
    setRepeatMode,
    setVolume,
    shuffle,
    toggleShuffle,
    volume,
  });

  useMediaSession({
    currentTime,
    currentTrack,
    duration,
    isPlaying,
    next,
    pause,
    prev,
    resume,
    seek,
  });
}
