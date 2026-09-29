import { getListenRuntime } from "./platform";

type TauriExternalLinkBridge = Window & {
  __crateOpenExternalUrl?: (url: string) => Promise<void>;
};

export async function openExternalUrl(url: string): Promise<void> {
  const safeUrl = normalizeExternalUrl(url);
  const runtime = getListenRuntime();

  if (runtime === "tauri") {
    const opener = (window as TauriExternalLinkBridge).__crateOpenExternalUrl;
    if (!opener) throw new Error("Tauri external opener is unavailable");
    await opener(safeUrl);
    return;
  }

  if (runtime === "capacitor") {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: safeUrl });
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = safeUrl;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

function normalizeExternalUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim(), window.location.origin);
  } catch {
    throw new Error("External link must be an absolute HTTP or HTTPS URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS external links are supported");
  }
  return parsed.href;
}
