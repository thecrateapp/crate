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
import { api, ensureMediaAccessUrl } from "@/lib/api";
import {
  DesktopControlError,
  playDesktopRef,
  queueDesktopRef,
  searchForDesktop,
  type DesktopPlayDeps,
} from "@/lib/desktop-control-search";
import {
  findLoadedImage,
  prefetchLauncherArt,
  rememberLauncherArtSource,
  squareJpeg,
  type LauncherArtDeps,
} from "@/lib/desktop-launcher-art";
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
  | "addToQueue"
  | "jamQueueLocked"
> & { volume: number };

// built per command, so modules that mock these imports still load
const playDeps = (): DesktopPlayDeps => ({
  resolveTrack: resolveRemotePlayableTrack,
  fetchAlbumTracks,
  fetchArtistTopTracks,
});

export const LAUNCHER_ART_DEPS: LauncherArtDeps = {
  authorize: (url) => ensureMediaAccessUrl(url, "artwork"),
  fetch: (url, init) => fetch(url, init),
  loadedImage: (url) => findLoadedImage(url),
  toSquare: squareJpeg,
  store: (key, bytes) =>
    window.__crateTauriInvoke?.("store_launcher_art", { key, bytes }) ??
    Promise.resolve(false),
};

interface DesktopControlReplyResult {
  delivered?: boolean;
  missingArt?: unknown;
}

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
        // answer the asking widget, even with nothing found or on error;
        // then fetch, in the background, the art the shell has not cached
        void searchForDesktop(
          command.query,
          (url) => api(url),
          rememberLauncherArtSource,
        )
          .catch(() => [])
          .then((items) =>
            window.__crateTauriInvoke?.<DesktopControlReplyResult | boolean>(
              "desktop_control_reply",
              { request: command.request, items },
            ),
          )
          .then((result) => {
            if (result && typeof result === "object") {
              return prefetchLauncherArt(result.missingArt, LAUNCHER_ART_DEPS);
            }
          })
          .catch(() => {});
        return;
      }
      if (command.cmd === "play_item") {
        void playDesktopRef(
          command.item,
          { play: current.play, playAll: current.playAll },
          playDeps(),
        ).catch(() => {});
        return;
      }
      if (command.cmd === "queue_item") {
        // the shell acks the socket client only once this answers
        void queueDesktopRef(
          command.item,
          {
            addToQueue: current.addToQueue,
            jamQueueLocked: current.jamQueueLocked,
          },
          playDeps(),
        )
          .then(
            () => null,
            (error: unknown) =>
              error instanceof DesktopControlError
                ? error.message
                : "Crate could not queue that item",
          )
          .then((error) =>
            window.__crateTauriInvoke?.("desktop_control_done", {
              request: command.request,
              error,
            }),
          )
          .catch(() => {});
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
