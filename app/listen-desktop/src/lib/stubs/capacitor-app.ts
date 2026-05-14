import type { PluginListenerHandle } from "./capacitor-core";

const noopHandle: PluginListenerHandle = {
  remove: async () => {},
};

export const App = {
  addListener: async (
    _eventName: string,
    _listener: (event: never) => void,
  ): Promise<PluginListenerHandle> => noopHandle,
  exitApp: () => {},
  getLaunchUrl: async (): Promise<{ url: string | null }> => ({ url: null }),
};
