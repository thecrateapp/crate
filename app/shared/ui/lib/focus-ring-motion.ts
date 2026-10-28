type FocusMotion = {
  shadow: string;
  offShadow: string;
  animation?: Animation;
};

export function installFocusRingMotion(root: Document = document): () => void {
  const view = root.defaultView;
  if (
    !view ||
    typeof Element.prototype.animate !== "function" ||
    typeof view.matchMedia !== "function"
  ) {
    return () => {};
  }

  const getStyle = view.getComputedStyle.bind(view);
  const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)");
  const forcedColors = view.matchMedia("(forced-colors: active)");
  const motions = new WeakMap<Element, FocusMotion>();
  const running = new Set<Element>();

  function disabled(element: Element): boolean {
    return (
      reducedMotion.matches ||
      forcedColors.matches ||
      element
        .closest("[data-crate-motion]")
        ?.getAttribute("data-crate-motion") === "reduced"
    );
  }

  function cancel(element: Element): void {
    motions.get(element)?.animation?.cancel();
    element.removeAttribute("data-crate-focus-motion");
    motions.delete(element);
    running.delete(element);
  }

  function animate(element: Element, leaving: boolean): void {
    if (!(element instanceof HTMLElement)) return;
    const previous = motions.get(element);
    if (!element.isConnected || disabled(element)) {
      cancel(element);
      return;
    }

    const current = previous?.animation
      ? getStyle(element)
          .boxShadow.split(/,(?![^()]*\))/)
          .pop()
          ?.trim()
      : leaving
        ? previous?.shadow
        : undefined;
    cancel(element);

    const css = getStyle(element);
    if (!leaving && css.outlineStyle === "none") return;
    const inset = parseFloat(css.outlineOffset) < 0 ? "inset " : "";
    const shadow = leaving
      ? previous?.shadow
      : `${inset}0px 0px 0px ${css.outlineWidth} ${css.outlineColor}`;
    const offShadow = leaving
      ? previous?.offShadow
      : `${inset}0px 0px 0px 0px transparent`;
    if (!shadow || !offShadow) return;

    const animation = element.animate(
      [
        { boxShadow: current ?? offShadow },
        { boxShadow: leaving ? offShadow : shadow },
      ],
      {
        duration: 500,
        easing: "cubic-bezier(0.22, 1.18, 0.36, 1)",
        fill: "both",
        composite: "add",
      },
    );
    if ((animation.effect as KeyframeEffect | null)?.composite !== "add") {
      animation.cancel();
      return;
    }
    element.setAttribute("data-crate-focus-motion", "");
    animation.id = "crate-focus-ring";
    const motion: FocusMotion = { shadow, offShadow, animation };
    motions.set(element, motion);
    running.add(element);
    animation.onfinish = () => {
      if (motions.get(element) !== motion) return;
      animation.cancel();
      element.removeAttribute("data-crate-focus-motion");
      running.delete(element);
      if (leaving) motions.delete(element);
      else motion.animation = undefined;
    };
  }

  function focusIn(event: FocusEvent): void {
    if (
      event.target instanceof Element &&
      event.target.matches(":focus-visible")
    ) {
      animate(event.target, false);
    }
  }

  function focusOut(event: FocusEvent): void {
    if (event.target instanceof Element && motions.has(event.target)) {
      animate(event.target, true);
    }
  }

  function cancelDisabled(): void {
    for (const element of running) {
      if (disabled(element)) cancel(element);
    }
  }

  const observer = new MutationObserver(cancelDisabled);
  observer.observe(root.documentElement, {
    attributes: true,
    subtree: true,
    attributeFilter: ["data-crate-motion"],
  });
  reducedMotion.addEventListener("change", cancelDisabled);
  forcedColors.addEventListener("change", cancelDisabled);
  root.addEventListener("focusin", focusIn);
  root.addEventListener("focusout", focusOut);

  return () => {
    root.removeEventListener("focusin", focusIn);
    root.removeEventListener("focusout", focusOut);
    reducedMotion.removeEventListener("change", cancelDisabled);
    forcedColors.removeEventListener("change", cancelDisabled);
    observer.disconnect();
    for (const element of running) cancel(element);
  };
}
