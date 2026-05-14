export type DesktopTrayCommand =
  | "play"
  | "pause"
  | "play_pause"
  | "previous"
  | "next";

export const DESKTOP_TRAY_COMMAND_EVENT = "crate:desktop-tray-command";

export interface DesktopNowPlayingPayload {
  title: string | null;
  artist: string | null;
  isPlaying: boolean;
}

export interface DesktopMediaSessionPayload extends DesktopNowPlayingPayload {
  album: string | null;
  artwork: string | null;
  position: number;
  duration: number;
}

export function dispatchDesktopTrayCommand(command: DesktopTrayCommand): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DesktopTrayCommand>(DESKTOP_TRAY_COMMAND_EVENT, {
      detail: command,
    }),
  );
}

export function syncDesktopNowPlaying(payload: DesktopNowPlayingPayload): void {
  if (typeof window === "undefined" || !window.__crateTauriInvoke) return;
  void window
    .__crateTauriInvoke("update_now_playing", { payload })
    .catch(() => undefined);
}

export function syncDesktopMediaSession(
  payload: DesktopMediaSessionPayload,
): void {
  if (typeof window === "undefined" || !window.__crateTauriInvoke) return;
  void window
    .__crateTauriInvoke("update_desktop_media_session", { payload })
    .catch(() => undefined);
}
