import { useState, useEffect } from "react";

const isServer = typeof window === "undefined";

interface UseIsDesktopOptions {
  ssr?: boolean;
}

export function useIsDesktop(options?: UseIsDesktopOptions) {
  const ssrFallback = options?.ssr ?? false;
  const [isDesktop, setIsDesktop] = useState(() =>
    isServer ? ssrFallback : window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}
