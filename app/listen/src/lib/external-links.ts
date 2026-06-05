type TauriOpenerGlobal = Window &
  typeof globalThis & {
    __TAURI__?: {
      opener?: {
        openUrl?: (url: string) => Promise<void> | void;
        open?: (url: string) => Promise<void> | void;
      };
      shell?: {
        open?: (url: string) => Promise<void> | void;
      };
    };
  };

export async function openExternalUrl(url: string): Promise<void> {
  const tauri = (window as TauriOpenerGlobal).__TAURI__;
  const opener =
    tauri?.opener?.openUrl ?? tauri?.opener?.open ?? tauri?.shell?.open;
  if (opener) {
    await opener(url);
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = url;
}
