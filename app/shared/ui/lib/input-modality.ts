let pointerInteraction = false;
let keyboardInteraction = false;
let tracking = false;

function touchOnlyScreen(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none)").matches
  );
}

export function trackInputModality(): void {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        pointerInteraction = false;
        keyboardInteraction = true;
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      pointerInteraction = true;
      keyboardInteraction = false;
    },
    true,
  );
}

export function touchWithoutKeyboard(): boolean {
  return !keyboardInteraction && touchOnlyScreen();
}

export function focusFollowsPointer(): boolean {
  return pointerInteraction || touchWithoutKeyboard();
}

export function focusWithModality(
  element: HTMLElement | null | undefined,
  options?: FocusOptions,
): void {
  if (!element) return;
  trackInputModality();
  element.focus(
    focusFollowsPointer()
      ? ({ ...options, focusVisible: false } as FocusOptions)
      : options,
  );
}
