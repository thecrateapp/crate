import { useEffect, useRef, useSyncExternalStore } from "react";

import type { PlayerActionsValue } from "@/contexts/player-context";
import { useEqualizerSnapshotState } from "@/hooks/use-equalizer-runtime";
import {
  applyDesktopControlCommand,
  buildDesktopControlState,
  DESKTOP_CONTROL_COMMAND_EVENT,
  getResolvedEqualizer,
  parseDesktopControlCommand,
  publishDesktopControlState,
  subscribeResolvedEqualizer,
  type DesktopControlActions,
} from "@/lib/desktop-control";
import {
  applyEqualizerPreset,
  setCustomEqualizerGains,
  setEqualizerAdaptive,
  setEqualizerEnabled,
  setEqualizerGenreAdaptive,
  setEqualizerSmart,
} from "@/lib/equalizer-prefs";
import {
  fetchAlbumTracks,
  fetchArtistTopTracks,
} from "@/components/actions/shared";
import { api } from "@/lib/api";
import { playDesktopRef, searchForDesktop } from "@/lib/desktop-control-search";
import { isTauriRuntime } from "@/lib/platform";
import { resolveRemotePlayableTrack } from "@/lib/remote-track-playback";

type BridgeInput = Pick<
  PlayerActionsValue,
  | "seek"
  | "setVolume"
  | "shuffle"
  | "toggleShuffle"
  | "repeat"
  | "setRepeatMode"
  | "play"
  | "playAll"
> & { volume: number };

const EQ_ACTIONS: DesktopControlActions["eq"] = {
  setEnabled: setEqualizerEnabled,
  setSmart: setEqualizerSmart,
  setAdaptive: setEqualizerAdaptive,
  setGenreAdaptive: setEqualizerGenreAdaptive,
  applyPreset: (preset) => void applyEqualizerPreset(preset),
  setCustomGains: setCustomEqualizerGains,
};

/**
 * Desktop only: publish volume, shuffle, repeat and the equalizer to the
 * native shell, and apply the commands it relays (from a desktop widget).
 */
export function useDesktopControlBridge(input: BridgeInput) {
  const [snapshot] = useEqualizerSnapshotState();
  const resolved = useSyncExternalStore(
    subscribeResolvedEqualizer,
    getResolvedEqualizer,
    getResolvedEqualizer,
  );

  const actionsRef = useRef(input);
  actionsRef.current = input;

  const { volume, shuffle, repeat } = input;
  useEffect(() => {
    if (!isTauriRuntime) return;
    publishDesktopControlState(
      buildDesktopControlState({ volume, shuffle, repeat, snapshot, resolved }),
      window.__crateTauriInvoke,
    );
  }, [repeat, resolved, shuffle, snapshot, volume]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const onCommand = (event: Event) => {
      const command = parseDesktopControlCommand(
        (event as CustomEvent<unknown>).detail,
      );
      if (!command) return;
      const current = actionsRef.current;
      if (command.cmd === "search") {
        // answer the asking widget, even with nothing found or on error
        void searchForDesktop(command.query, (url) => api(url))
          .catch(() => [])
          .then((items) =>
            window.__crateTauriInvoke?.("desktop_control_reply", {
              request: command.request,
              items,
            }),
          )
          .catch(() => {});
        return;
      }
      if (command.cmd === "play_item") {
        void playDesktopRef(
          command.item,
          { play: current.play, playAll: current.playAll },
          {
            resolveTrack: resolveRemotePlayableTrack,
            fetchAlbumTracks,
            fetchArtistTopTracks,
          },
        ).catch(() => {});
        return;
      }
      applyDesktopControlCommand(command, {
        seek: current.seek,
        setVolume: current.setVolume,
        shuffle: current.shuffle,
        toggleShuffle: current.toggleShuffle,
        setRepeatMode: current.setRepeatMode,
        eq: EQ_ACTIONS,
      });
    };
    window.addEventListener(DESKTOP_CONTROL_COMMAND_EVENT, onCommand);
    return () =>
      window.removeEventListener(DESKTOP_CONTROL_COMMAND_EVENT, onCommand);
  }, []);
}
