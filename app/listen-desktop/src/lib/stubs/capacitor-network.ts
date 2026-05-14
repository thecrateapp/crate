import type { PluginListenerHandle } from "./capacitor-core";

const noopHandle: PluginListenerHandle = {
  remove: async () => {},
};

export const Network = {
  getStatus: async () => ({ connected: navigator.onLine }),
  addListener: async (
    _eventName: string,
    _listener: (status: { connected: boolean }) => void,
  ): Promise<PluginListenerHandle> => noopHandle,
};
