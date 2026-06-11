export const HOVER_POINTER_MEDIA_QUERY = "(hover: hover) and (pointer: fine)";

export function canUseHoverPointer(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia(HOVER_POINTER_MEDIA_QUERY).matches;
}

export function isTouchDominantPointer(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  if (navigator.maxTouchPoints > 0) {
    return true;
  }
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches
  );
}

export function subscribeHoverPointer(
  callback: (canHover: boolean) => void,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    callback(false);
    return () => {};
  }

  const query = window.matchMedia(HOVER_POINTER_MEDIA_QUERY);
  const update = () => callback(query.matches);
  update();
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}
