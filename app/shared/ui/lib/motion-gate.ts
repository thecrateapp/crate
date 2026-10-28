import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

export function isMotionBlocked(): boolean {
  if (typeof document !== "undefined") {
    if (document.visibilityState === "hidden") return true;
    if (document.documentElement.dataset.crateMotion === "reduced") return true;
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
        attributeFilter: ["data-crate-motion"],
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
