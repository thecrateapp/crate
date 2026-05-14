import { useState, useEffect } from "react";

function isDesktopForcedRuntime(): boolean {
  return (
    document.documentElement.dataset.listenRuntime === "tauri" ||
    "__TAURI_INTERNALS__" in window
  );
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () =>
      isDesktopForcedRuntime() ||
      window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    if (isDesktopForcedRuntime()) {
      setIsDesktop(true);
      return;
    }
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}
