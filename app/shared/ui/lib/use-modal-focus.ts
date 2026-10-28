import { useEffect, useEffectEvent, type RefObject } from "react";
import { acquireBodyScrollLock } from "./body-scroll-lock";
import { touchWithoutKeyboard, trackInputModality } from "./input-modality";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function topModal(doc: Document) {
  const panels = Array.from(
    doc.querySelectorAll<HTMLElement>("[data-app-modal-panel]"),
  )
    .filter(
      (panel) => !panel.closest('[hidden], [inert], [aria-hidden="true"]'),
    )
    .sort(
      (a, b) => Number(a.dataset.modalDepth) - Number(b.dataset.modalDepth),
    );
  return panels[panels.length - 1];
}

function focusableElements(panel: HTMLElement) {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      element.getAttribute("type") !== "hidden" &&
      getComputedStyle(element).display !== "none" &&
      getComputedStyle(element).visibility !== "hidden",
  );
}

function isolateBackground(panel: HTMLElement) {
  const previous: Array<{
    element: Element;
    inert: boolean;
    hidden: string | null;
  }> = [];
  let branch: Element = panel;
  while (branch.parentElement && branch !== panel.ownerDocument.body) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (
        sibling === branch ||
        sibling.tagName === "SCRIPT" ||
        sibling.tagName === "STYLE"
      )
        continue;
      const higherPanel = sibling.matches("[data-app-modal-panel]")
        ? sibling
        : sibling.querySelector("[data-app-modal-panel]");
      if (
        higherPanel instanceof HTMLElement &&
        Number(higherPanel.dataset.modalDepth) >
          Number(panel.dataset.modalDepth)
      )
        continue;
      previous.push({
        element: sibling,
        inert: sibling.hasAttribute("inert"),
        hidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = branch.parentElement;
  }
  return () => {
    for (const { element, inert, hidden } of previous) {
      if (!inert) element.removeAttribute("inert");
      if (hidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", hidden);
    }
  };
}

interface UseModalFocusOptions {
  active: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onEscape?: (event: KeyboardEvent) => void;
  /** Specialized workspaces can keep the dock keyboard-accessible. */
  containFocus?: boolean;
  isolate?: boolean;
  /** Resolves a replacement trigger when opening unmounts the original one. */
  restoreFocusTarget?: () => HTMLElement | null;
}

/** The AppModal focus lifecycle, also used by specialized full-screen surfaces. */
export function useModalFocus({
  active,
  panelRef,
  onEscape,
  containFocus = true,
  isolate = false,
  restoreFocusTarget,
}: UseModalFocusOptions) {
  const escape = useEffectEvent((event: KeyboardEvent) => onEscape?.(event));
  const restoreTarget = useEffectEvent(() => restoreFocusTarget?.() ?? null);

  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;
    const doc = panel.ownerDocument;
    const previous =
      doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body
        ? doc.activeElement
        : null;
    trackInputModality();
    const releaseIsolation = isolate ? isolateBackground(panel) : undefined;
    const releaseScrollLock = isolate ? acquireBodyScrollLock(doc) : undefined;
    const frame = window.requestAnimationFrame(() => {
      if (topModal(doc) !== panel) return;
      if (
        doc.activeElement instanceof HTMLElement &&
        panel.contains(doc.activeElement)
      )
        return;
      if (touchWithoutKeyboard()) {
        panel.focus({ focusVisible: false } as FocusOptions);
        return;
      }
      (focusableElements(panel)[0] ?? panel).focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        topModal(doc) !== panel ||
        event.defaultPrevented ||
        event.isComposing
      )
        return;
      if (event.key === "Escape") escape(event);
      if (!containFocus || event.key !== "Tab") return;
      const focusable = focusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = doc.activeElement;
      if (event.shiftKey && (focused === first || focused === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      releaseIsolation?.();
      releaseScrollLock?.();
      const target = previous?.isConnected ? previous : restoreTarget();
      const remaining = topModal(doc);
      if (
        target?.isConnected &&
        !target.closest('[hidden], [inert], [aria-hidden="true"]') &&
        (!remaining || remaining === panel || remaining.contains(target))
      )
        target.focus(
          touchWithoutKeyboard()
            ? ({ focusVisible: false } as FocusOptions)
            : undefined,
        );
    };
  }, [active, containFocus, isolate, panelRef]);
}
