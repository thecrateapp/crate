import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * A native shell (Tauri desktop) marks the document hidden while the
 * compositor shows its window on no monitor, or it is minimised. WebKitGTK
 * keeps `document.visibilityState` at "visible" there, and keeps running
 * requestAnimationFrame and CSS animations. An unfocused but visible window is
 * not hidden and keeps animating. Browsers and the PWA never set this.
 * CSS keys off the same attribute to pause infinite animations.
 */
export const WINDOW_VISIBILITY_ATTRIBUTE = "data-crate-window";

export function setWindowHidden(hidden: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (hidden) root.dataset.crateWindow = "hidden";
  else delete root.dataset.crateWindow;
}

export function isWindowHidden(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.crateWindow === "hidden"
  );
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
    if (isWindowHidden()) return true;
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
        attributeFilter: ["data-crate-motion", WINDOW_VISIBILITY_ATTRIBUTE],
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
