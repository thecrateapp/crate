// Desktop control bridge: lets the desktop shell (and, through it, a desktop
// widget such as the Ryoku bar's Crate plugin) read and change the player's
// volume, shuffle, repeat and equalizer.
//
// Listen publishes a small state object to the native shell with
// `update_desktop_control_state`; the shell validates and relays commands back
// as the `crate:desktop-control-command` window event. Transport (play, pause,
// next, previous) keeps using the tray command path (desktop-tray.ts).
//
// Mirrors ControlCommand in app/listen-desktop/src-tauri/src/desktop_control.rs:
// update both together.

import type { RepeatMode } from "@/contexts/player-types";
import {
  EQ_BANDS,
  EQ_BAND_COUNT,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_PRESETS,
  type EqGains,
} from "@/lib/equalizer";
import type { EqualizerSnapshot } from "@/lib/equalizer-prefs";
import type { EqSource } from "@/lib/equalizer-types";
import {
  parseDesktopPlayRef,
  type DesktopPlayRef,
} from "@/lib/desktop-control-search";

export const DESKTOP_CONTROL_COMMAND_EVENT = "crate:desktop-control-command";

export type DesktopEqMode = "smart" | "genre" | "adaptive" | "manual";

export type DesktopControlCommand =
  | { cmd: "seek"; position: number }
  | { cmd: "set_volume"; volume: number }
  | { cmd: "set_shuffle"; on: boolean }
  | { cmd: "set_repeat"; mode: RepeatMode }
  | { cmd: "eq_enabled"; on: boolean }
  | { cmd: "eq_mode"; mode: DesktopEqMode }
  | { cmd: "eq_preset"; preset: string }
  | { cmd: "eq_gains"; gains: number[] }
  | { cmd: "search"; query: string; request: number }
  | { cmd: "play_item"; item: DesktopPlayRef }
  | { cmd: "queue_item"; item: DesktopPlayRef; request: number }
  | { cmd: "show"; item: DesktopPlayRef };

export interface DesktopControlState {
  player: { volume: number; shuffle: boolean; repeat: RepeatMode };
  eq: {
    enabled: boolean;
    mode: DesktopEqMode;
    preset: string;
    gains: number[];
    bands: string[];
    presets: string[];
    source: EqSource | null;
    detail: string | null;
  };
}

const EQ_MODES: readonly DesktopEqMode[] = [
  "smart",
  "genre",
  "adaptive",
  "manual",
];
const REPEAT_MODES: readonly RepeatMode[] = ["off", "one", "all"];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate a relayed command; anything unexpected is dropped. */
export function parseDesktopControlCommand(
  value: unknown,
): DesktopControlCommand | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  switch (v.cmd) {
    case "seek":
      return finite(v.position) && v.position >= 0
        ? { cmd: "seek", position: v.position }
        : null;
    case "set_volume":
      return finite(v.volume)
        ? { cmd: "set_volume", volume: Math.min(1, Math.max(0, v.volume)) }
        : null;
    case "set_shuffle":
    case "eq_enabled":
      return typeof v.on === "boolean" ? { cmd: v.cmd, on: v.on } : null;
    case "set_repeat":
      return REPEAT_MODES.includes(v.mode as RepeatMode)
        ? { cmd: "set_repeat", mode: v.mode as RepeatMode }
        : null;
    case "eq_mode":
      return EQ_MODES.includes(v.mode as DesktopEqMode)
        ? { cmd: "eq_mode", mode: v.mode as DesktopEqMode }
        : null;
    case "eq_preset":
      return typeof v.preset === "string" &&
        Object.prototype.hasOwnProperty.call(EQ_PRESETS, v.preset)
        ? { cmd: "eq_preset", preset: v.preset }
        : null;
    case "eq_gains":
      return Array.isArray(v.gains) &&
        v.gains.length === EQ_BAND_COUNT &&
        v.gains.every(finite)
        ? {
            cmd: "eq_gains",
            gains: (v.gains as number[]).map((g) =>
              Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, g)),
            ),
          }
        : null;
    case "search":
      return typeof v.query === "string" &&
        v.query.trim().length > 0 &&
        v.query.length <= 200 &&
        Number.isInteger(v.request) &&
        (v.request as number) > 0
        ? { cmd: "search", query: v.query.trim(), request: v.request as number }
        : null;
    case "play_item": {
      const item = parseDesktopPlayRef(v.item);
      return item ? { cmd: "play_item", item } : null;
    }
    case "queue_item": {
      // the shell waits for desktop_control_done with this request id
      const item = parseDesktopPlayRef(v.item);
      return item && Number.isInteger(v.request) && (v.request as number) > 0
        ? { cmd: "queue_item", item, request: v.request as number }
        : null;
    }
    case "show": {
      // a plain `show` only raises the window and never reaches the webview
      const item = parseDesktopPlayRef(v.item);
      return item ? { cmd: "show", item } : null;
    }
    default:
      return null;
  }
}

export function dispatchDesktopControlCommand(
  command: DesktopControlCommand,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DesktopControlCommand>(DESKTOP_CONTROL_COMMAND_EVENT, {
      detail: command,
    }),
  );
}

export function eqModeOf(snapshot: EqualizerSnapshot): DesktopEqMode {
  // Same priority as useResolvedEqualizer: smart, adaptive, genre, manual.
  if (snapshot.smart) return "smart";
  if (snapshot.adaptive) return "adaptive";
  if (snapshot.genreAdaptive) return "genre";
  return "manual";
}

export interface DesktopControlActions {
  seek: (position: number) => void;
  setVolume: (volume: number) => void;
  shuffle: boolean;
  toggleShuffle: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  eq: {
    setEnabled: (on: boolean) => void;
    setSmart: (on: boolean) => void;
    setAdaptive: (on: boolean) => void;
    setGenreAdaptive: (on: boolean) => void;
    applyPreset: (preset: string) => void;
    setCustomGains: (gains: EqGains) => void;
  };
}

export function applyDesktopControlCommand(
  command: DesktopControlCommand,
  actions: DesktopControlActions,
): void {
  switch (command.cmd) {
    case "seek":
      actions.seek(command.position);
      return;
    case "set_volume":
      actions.setVolume(command.volume);
      return;
    case "set_shuffle":
      if (command.on !== actions.shuffle) actions.toggleShuffle();
      return;
    case "set_repeat":
      actions.setRepeatMode(command.mode);
      return;
    case "eq_enabled":
      actions.eq.setEnabled(command.on);
      return;
    case "eq_mode":
      // Picking a mode from the desktop means "use it": the EQ turns on too.
      actions.eq.setEnabled(true);
      if (command.mode === "smart") actions.eq.setSmart(true);
      else if (command.mode === "adaptive") actions.eq.setAdaptive(true);
      else if (command.mode === "genre") actions.eq.setGenreAdaptive(true);
      else {
        actions.eq.setSmart(false);
        actions.eq.setAdaptive(false);
        actions.eq.setGenreAdaptive(false);
      }
      return;
    case "eq_preset":
      actions.eq.setEnabled(true);
      actions.eq.applyPreset(command.preset);
      return;
    case "eq_gains":
      actions.eq.setEnabled(true);
      actions.eq.setCustomGains(command.gains);
      return;
    case "search":
    case "play_item":
    case "queue_item":
      // asynchronous: handled by the bridge (use-desktop-control-bridge.ts)
      return;
    case "show":
      // navigation: handled by the desktop shell's router
      // (app/listen-desktop/src/components/DesktopControlNavigator.tsx)
      return;
  }
}

// ---- what the EQ runtime resolved for the current track -------------------

export interface ResolvedEqualizerReport {
  /** The mode the runtime resolved for; a report for another mode is stale. */
  mode: DesktopEqMode | null;
  gains: EqGains;
  source: EqSource | null;
  detail: string | null;
}

const EMPTY_REPORT: ResolvedEqualizerReport = {
  mode: null,
  gains: [],
  source: null,
  detail: null,
};
let resolvedReport: ResolvedEqualizerReport = EMPTY_REPORT;
const resolvedListeners = new Set<() => void>();

/** Called by the EQ runtime each time it resolves the gains it applies. */
export function reportResolvedEqualizer(report: ResolvedEqualizerReport): void {
  const same =
    report.mode === resolvedReport.mode &&
    report.source === resolvedReport.source &&
    report.detail === resolvedReport.detail &&
    report.gains.length === resolvedReport.gains.length &&
    report.gains.every((g, i) => g === resolvedReport.gains[i]);
  if (same) return;
  resolvedReport = report;
  resolvedListeners.forEach((listener) => listener());
}

export function getResolvedEqualizer(): ResolvedEqualizerReport {
  return resolvedReport;
}

export function subscribeResolvedEqualizer(listener: () => void): () => void {
  resolvedListeners.add(listener);
  return () => resolvedListeners.delete(listener);
}

// ---- state published to the shell -------------------------------------------

const roundGain = (g: number) => Math.round(g * 10) / 10;

export function buildDesktopControlState(input: {
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  snapshot: EqualizerSnapshot;
  resolved: ResolvedEqualizerReport;
}): DesktopControlState {
  const { snapshot } = input;
  const mode = eqModeOf(snapshot);
  // Right after a mode switch the runtime has not resolved the new mode yet:
  // keep its last curve but drop a source/detail that belongs to the old mode.
  const resolved =
    input.resolved.mode === mode
      ? input.resolved
      : { ...input.resolved, source: null, detail: null };
  const gains =
    resolved.gains.length === EQ_BAND_COUNT ? resolved.gains : snapshot.gains;
  return {
    player: {
      volume: Math.round(Math.min(1, Math.max(0, input.volume)) * 100) / 100,
      shuffle: input.shuffle,
      repeat: input.repeat,
    },
    eq: {
      enabled: snapshot.enabled,
      mode,
      preset: snapshot.preset,
      gains: Array.from(gains, roundGain),
      bands: EQ_BANDS.map((band) => band.label),
      presets: Object.keys(EQ_PRESETS),
      source: mode === "smart" ? resolved.source : null,
      detail: mode === "manual" ? null : resolved.detail,
    },
  };
}

let lastPublished: string | null = null;

/** Send the state to the shell when it changed; returns whether it sent. */
export function publishDesktopControlState(
  state: DesktopControlState,
  invoke: typeof window.__crateTauriInvoke,
): boolean {
  if (!invoke) return false;
  const key = JSON.stringify(state);
  if (key === lastPublished) return false;
  lastPublished = key;
  void invoke("update_desktop_control_state", { state }).catch(() => {
    // An older shell lacks the command; publish again on the next change.
    lastPublished = null;
  });
  return true;
}

export function resetDesktopControlStateForTests(): void {
  lastPublished = null;
  resolvedReport = EMPTY_REPORT;
  resolvedListeners.clear();
}
