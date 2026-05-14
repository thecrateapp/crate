import type { PluginListenerHandle } from "./capacitor-core";

const noopHandle: PluginListenerHandle = {
  remove: async () => {},
};

export enum KeyboardResize {
  Body = "body",
}

export enum KeyboardStyle {
  Dark = "dark",
}

export const Keyboard = {
  setStyle: async (_options: { style: KeyboardStyle }) => {},
  setResizeMode: async (_options: { mode: KeyboardResize }) => {},
  setAccessoryBarVisible: async (_options: { isVisible: boolean }) => {},
  setScroll: async (_options: { isDisabled: boolean }) => {},
  addListener: async (
    _eventName: string,
    _listener: (event: { keyboardHeight: number }) => void,
  ): Promise<PluginListenerHandle> => noopHandle,
};
