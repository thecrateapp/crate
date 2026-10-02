export function usesListenRootScrollContainer(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.crateLinuxWindowChrome === "true"
  );
}

export function getListenViewportScrollElement(): HTMLElement | null {
  if (!usesListenRootScrollContainer()) return null;
  return document.getElementById("root");
}

export function getListenViewportScrollTop(): number {
  if (typeof window === "undefined") return 0;

  if (usesListenRootScrollContainer()) {
    return getListenViewportScrollElement()?.scrollTop ?? 0;
  }

  return window.scrollY;
}
