const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function isMotionBlocked(): boolean {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    return true;
  }

  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

export function subscribeToMotionAvailability(
  onChange: () => void,
): () => void {
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onChange);
  }

  const mediaQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_MOTION_QUERY)
      : null;
  mediaQuery?.addEventListener("change", onChange);

  return () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onChange);
    }
    mediaQuery?.removeEventListener("change", onChange);
  };
}
