import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * A native shell (Tauri desktop) marks the document inactive while its window
 * is unfocused or minimised. WebKitGTK keeps reporting `visible` for a window
 * behind others or on another workspace, so visibility alone never pauses
 * decorative loops there. Browsers and the PWA never set this attribute.
 */
export const WINDOW_ACTIVITY_ATTRIBUTE = "data-crate-window";

export function setWindowInactive(inactive: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (inactive) root.dataset.crateWindow = "inactive";
  else delete root.dataset.crateWindow;
}

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

export function isMotionBlocked(): boolean {
  if (typeof document !== "undefined") {
    if (document.visibilityState === "hidden") return true;
    if (document.documentElement.dataset.crateMotion === "reduced") return true;
    if (document.documentElement.dataset.crateWindow === "inactive")
      return true;
  }
  return reducedMotionQuery()?.matches ?? false;
}

export function subscribeToMotionAvailability(
  onChange: () => void,
): () => void {
  const mediaQuery = reducedMotionQuery();
  mediaQuery?.addEventListener("change", onChange);

  let attributeObserver: MutationObserver | null = null;
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onChange);
    if (typeof MutationObserver !== "undefined") {
      attributeObserver = new MutationObserver(onChange);
      attributeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-crate-motion", WINDOW_ACTIVITY_ATTRIBUTE],
      });
    }
  }

  return () => {
    mediaQuery?.removeEventListener("change", onChange);
    attributeObserver?.disconnect();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onChange);
    }
  };
}

function motionAllowedSnapshot(): boolean {
  return !isMotionBlocked();
}

function motionAllowedServerSnapshot(): boolean {
  return false;
}

export function useMotionAllowed(): boolean {
  return useSyncExternalStore(
    subscribeToMotionAvailability,
    motionAllowedSnapshot,
    motionAllowedServerSnapshot,
  );
}
