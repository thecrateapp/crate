/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CRATE_CONNECT_FEATURE_ENABLED?: string;
  readonly VITE_EXPLORE_HOME_DISCOVERY_ENABLED?: string;
  readonly VITE_TAURI_OAUTH_WEB_BRIDGE?: string;
  readonly VITE_ALLOW_INSECURE_LOOPBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __crateTauriInvoke?: <T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
}
