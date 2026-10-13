const matches = (query: string) =>
  typeof window !== "undefined" && window.matchMedia(query).matches;

export const reducedMotion = () => matches("(prefers-reduced-motion: reduce)");
export const finePointer = () => matches("(pointer: fine)");
export const isMobile = () => matches("(max-width: 760px)");
