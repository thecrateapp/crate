/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_TAURI_OAUTH_WEB_BRIDGE?: string;
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
