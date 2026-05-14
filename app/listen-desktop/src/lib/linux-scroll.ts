const WHEEL_LINE_PX = 40;
const SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

let initialized = false;

export function initLinuxScrollBehavior(): void {
  if (initialized || typeof window === "undefined" || !isLinuxWebView()) return;
  initialized = true;

  document.documentElement.dataset.crateLinuxDesktop = "true";
  window.addEventListener("wheel", handleWheel, {
    capture: true,
    passive: false,
  });
}

function isLinuxWebView(): boolean {
  return typeof navigator !== "undefined" && /\bLinux\b/i.test(navigator.userAgent);
}

function handleWheel(event: WheelEvent): void {
  if (event.defaultPrevented || event.ctrlKey) return;

  const target = event.target;
  if (!(target instanceof Node)) return;

  const delta = normalizedWheelDelta(event);
  if (Math.abs(delta.x) < 0.01 && Math.abs(delta.y) < 0.01) return;

  const axis = dominantAxis(delta);
  const amount = axis === "x" ? delta.x : delta.y;
  const scrollTarget = findScrollableTarget(target, axis, amount);

  if (!scrollTarget) {
    if (axis === "x") event.preventDefault();
    return;
  }

  event.preventDefault();
  scrollTarget.scrollBy({
    left: axis === "x" ? amount : 0,
    top: axis === "y" ? amount : 0,
    behavior: "auto",
  });
}

function normalizedWheelDelta(event: WheelEvent): { x: number; y: number } {
  const factor =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? WHEEL_LINE_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;
  const shiftWheelX = event.shiftKey && Math.abs(event.deltaX) < 0.01;

  return {
    x: (shiftWheelX ? event.deltaY : event.deltaX) * factor,
    y: (shiftWheelX ? 0 : event.deltaY) * factor,
  };
}

function dominantAxis(delta: { x: number; y: number }): "x" | "y" {
  return Math.abs(delta.x) > Math.abs(delta.y) ? "x" : "y";
}

function findScrollableTarget(
  target: Node,
  axis: "x" | "y",
  amount: number,
): HTMLElement | null {
  let element = elementFromNode(target);

  while (element) {
    if (canScrollElement(element, axis, amount)) return element;
    if (element === document.body || element === document.documentElement) break;
    element = element.parentElement;
  }

  const documentScroller = document.scrollingElement;
  if (
    documentScroller instanceof HTMLElement &&
    canScrollDocument(documentScroller, axis, amount)
  ) {
    return documentScroller;
  }

  return null;
}

function elementFromNode(node: Node): HTMLElement | null {
  if (node instanceof HTMLElement) return node;
  return node.parentElement instanceof HTMLElement ? node.parentElement : null;
}

function canScrollElement(
  element: HTMLElement,
  axis: "x" | "y",
  amount: number,
): boolean {
  if (element === document.body || element === document.documentElement) {
    return canScrollDocument(element, axis, amount);
  }

  const style = window.getComputedStyle(element);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  if (!SCROLLABLE_OVERFLOW.has(overflow)) return false;

  return canScrollInDirection(element, axis, amount);
}

function canScrollDocument(
  element: HTMLElement,
  axis: "x" | "y",
  amount: number,
): boolean {
  if (axis === "x") return false;
  return canScrollInDirection(element, axis, amount);
}

function canScrollInDirection(
  element: HTMLElement,
  axis: "x" | "y",
  amount: number,
): boolean {
  const maxScroll =
    axis === "y"
      ? element.scrollHeight - element.clientHeight
      : element.scrollWidth - element.clientWidth;
  if (maxScroll <= 1) return false;

  const current = axis === "y" ? element.scrollTop : element.scrollLeft;
  if (amount < 0) return current > 1;
  if (amount > 0) return current < maxScroll - 1;
  return false;
}
